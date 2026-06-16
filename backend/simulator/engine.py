import math
import logging
from logistics.models import Carrier, Shipment, SimulationRun, DisruptionEvent, AgentAuditLog
from django.utils import timezone

logger = logging.getLogger(__name__)

class LogisticsSimulator:
    def __init__(self, run_id):
        self.run = SimulationRun.objects.get(id=run_id)

    @classmethod
    def create_simulation_run(cls, name, total_ticks=48):
        """Creates a new simulation run instance."""
        run = SimulationRun.objects.create(
            name=name,
            status='IDLE',
            current_tick=0,
            total_ticks=total_ticks,
            total_cost=0.0,
            sla_compliance=1.0,
            emissions=0.0
        )
        return cls(run.id)

    def initialize_scenario(self, carriers_data, shipments_data, disruptions_data):
        """Seeds the database with carriers, shipments, and scheduled disruptions."""
        # 1. Setup Carriers
        for c in carriers_data:
            Carrier.objects.update_or_create(
                carrier_id=c['carrier_id'],
                defaults={
                    'name': c['name'],
                    'reliability': c.get('reliability', 1.0),
                    'sustainability': c.get('sustainability', 0.8),
                    'base_rate_per_mile': c.get('base_rate_per_mile', 1.5)
                }
            )

        # 2. Setup Shipments
        for s in shipments_data:
            carrier_obj = Carrier.objects.get(carrier_id=s['carrier_id']) if s.get('carrier_id') else None
            Shipment.objects.update_or_create(
                shipment_id=s['shipment_id'],
                defaults={
                    'origin': s['origin'],
                    'destination': s['destination'],
                    'status': s.get('status', 'PENDING'),
                    'carrier': carrier_obj,
                    'weight': s['weight'],
                    'cost': s.get('cost', 0.0),
                    'eta_ticks': s.get('eta_ticks', 0),
                    'deadline_ticks': s['deadline_ticks'],
                    'route_mileage': s['route_mileage'],
                    'current_position_progress': s.get('current_position_progress', 0.0)
                }
            )

        # 3. Setup Scheduled Disruption Events
        for d in disruptions_data:
            DisruptionEvent.objects.create(
                simulation_run=self.run,
                tick=d['tick'],
                event_type=d['event_type'],
                target_shipment_id=d.get('target_shipment_id'),
                description=d['description'],
                resolved=False
            )

        # Update run status
        self.run.status = 'IDLE'
        self.run.save()

    def step(self):
        """Advances the simulation by 1 tick (1 hour). Returns status info."""
        if self.run.status not in ['IDLE', 'RUNNING']:
            return {"error": "Simulation is not in a runnable state."}

        if self.run.current_tick >= self.run.total_ticks:
            self.run.status = 'COMPLETED'
            self.run.save()
            return {"message": "Simulation already completed."}

        self.run.status = 'RUNNING'
        current_tick = self.run.current_tick

        # --- 1. UPDATE ACTIVE SHIPMENTS PROGRESS ---
        active_shipments = Shipment.objects.filter(status__in=['ASSIGNED', 'IN_TRANSIT', 'DELAYED'])
        for shipment in active_shipments:
            # If assigned, it starts moving and becomes IN_TRANSIT
            if shipment.status == 'ASSIGNED':
                shipment.status = 'IN_TRANSIT'

            # Assume average truck speed: 50 miles per tick (hour).
            # A shipment progresses based on route mileage.
            if shipment.route_mileage > 0:
                speed_per_tick = 50.0 / shipment.route_mileage
            else:
                speed_per_tick = 1.0  # instant delivery

            # If delayed, progress is slowed by half for this tick
            if shipment.status == 'DELAYED':
                speed_per_tick *= 0.5

            shipment.current_position_progress += speed_per_tick

            # Check for delivery
            if shipment.current_position_progress >= 1.0:
                shipment.current_position_progress = 1.0
                shipment.status = 'DELIVERED'
                
                # Calculate cost based on carrier base rate
                if shipment.carrier:
                    shipment.cost = shipment.route_mileage * shipment.carrier.base_rate_per_mile
                else:
                    shipment.cost = shipment.route_mileage * 3.0  # penalty rate for no carrier (spot market default)

            shipment.save()

        # --- 2. TRIGGER DISRUPTIONS FOR THIS TICK ---
        disruptions = DisruptionEvent.objects.filter(simulation_run=self.run, tick=current_tick, resolved=False)
        triggered_events = []
        for event in disruptions:
            triggered_events.append(event)
            # Apply immediate disruption effect on model state
            if event.event_type == 'TRUCK_BREAKDOWN':
                # Mark target shipment as delayed, remove its carrier assignment (must be re-dispatched)
                if event.target_shipment_id:
                    try:
                        sh = Shipment.objects.get(shipment_id=event.target_shipment_id)
                        sh.status = 'DELAYED'
                        sh.save()
                    except Shipment.DoesNotExist:
                        pass
            elif event.event_type == 'WEATHER_DELAY':
                if event.target_shipment_id:
                    try:
                        sh = Shipment.objects.get(shipment_id=event.target_shipment_id)
                        sh.status = 'DELAYED'
                        sh.save()
                    except Shipment.DoesNotExist:
                        pass
            elif event.event_type == 'CARRIER_CANCELLATION':
                if event.target_shipment_id:
                    try:
                        sh = Shipment.objects.get(shipment_id=event.target_shipment_id)
                        sh.status = 'PENDING'
                        sh.carrier = None
                        sh.save()
                    except Shipment.DoesNotExist:
                        pass
            # RUSH_ORDER requires creating a new shipment on the fly
            elif event.event_type == 'RUSH_ORDER':
                # Details can be parsed from description or handled dynamically
                # Let's create a new shipment dynamically
                Shipment.objects.create(
                    shipment_id=f"RUSH-{current_tick}",
                    origin="Warehouse West",
                    destination="Customer Retail East",
                    status='PENDING',
                    weight=15000.0,
                    deadline_ticks=current_tick + 10,
                    route_mileage=450.0
                )

        # --- 3. RUN THE AI AGENT LOOP TO RESOLVE ACTIVE DISRUPTIONS ---
        # If there are active disruptions or shipments still pending assignment, invoke the agent
        unassigned_shipments = Shipment.objects.filter(status='PENDING')
        active_disruptions = DisruptionEvent.objects.filter(simulation_run=self.run, resolved=False)
        
        agent_invoked = False
        hitl_paused = False
        decision_required = None

        if active_disruptions.exists() or unassigned_shipments.exists():
            # Import agent loop here to prevent circular dependency
            from agents.loop import LogisticsAgent
            
            agent = LogisticsAgent(self.run.id)
            result = agent.run_decision_loop(current_tick)
            
            if result.get("paused_for_hitl"):
                hitl_paused = True
                decision_required = result.get("decision")
            agent_invoked = True

        # --- 4. CALCULATE OVERALL RUN KPIs ---
        all_shipments = Shipment.objects.all()
        total_cost = sum(sh.cost for sh in all_shipments)
        
        # Emissions: weight * mileage * carrier_sustainability_factor * constant
        total_emissions = 0.0
        for sh in all_shipments:
            if sh.status == 'DELIVERED' and sh.carrier:
                # Mock emission index: weight (tons) * distance (miles) * (1 - sustainability)
                weight_tons = sh.weight / 2000.0
                total_emissions += weight_tons * sh.route_mileage * (1.0 - sh.carrier.sustainability) * 0.1

        # SLA Compliance: delivered on-time vs delivered late + active overdue
        delivered_shipments = all_shipments.filter(status='DELIVERED')
        on_time = 0
        total_delivered = delivered_shipments.count()
        for sh in delivered_shipments:
            # If it arrived before or at the deadline tick, it is compliant
            # Note: in this simplified simulator, we can track actual delivery tick
            # We assume it arrived at current_tick if it just changed status, or it was already delivered.
            # Let's check eta vs deadline.
            if sh.eta_ticks <= sh.deadline_ticks:
                on_time += 1
        
        sla_compliance = (on_time / total_delivered) if total_delivered > 0 else 1.0

        # Save KPI updates
        self.run.total_cost = total_cost
        self.run.sla_compliance = sla_compliance
        self.run.emissions = total_emissions
        
        # Advance tick if not paused for human approval
        if not hitl_paused:
            self.run.current_tick += 1
            if self.run.current_tick >= self.run.total_ticks:
                self.run.status = 'COMPLETED'
            self.run.save()
        else:
            self.run.status = 'RUNNING'  # remains running but blocked on HITL
            self.run.save()

        return {
            "tick": current_tick,
            "status": self.run.status,
            "agent_invoked": agent_invoked,
            "hitl_paused": hitl_paused,
            "decision_required": decision_required,
            "kpis": {
                "total_cost": total_cost,
                "sla_compliance": sla_compliance,
                "emissions": total_emissions
            }
        }
