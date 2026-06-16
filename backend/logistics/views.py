from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from logistics.models import Carrier, Shipment, SimulationRun, DisruptionEvent, AgentAuditLog
from logistics.serializers import (
    CarrierSerializer, ShipmentSerializer, SimulationRunSerializer, 
    DisruptionEventSerializer, AgentAuditLogSerializer
)
from simulator.engine import LogisticsSimulator
from simulator.scenarios import SCENARIOS
from agents.tools import ToolRegistry

class CreateSimulationView(APIView):
    def post(self, request):
        scenario_key = request.data.get("scenario", "standard_run")
        if scenario_key not in SCENARIOS:
            return Response({"error": f"Scenario '{scenario_key}' not found."}, status=status.HTTP_400_BAD_REQUEST)
        
        scenario_data = SCENARIOS[scenario_key]
        
        # Clean up database for a clean sandbox run
        Shipment.objects.all().delete()
        DisruptionEvent.objects.all().delete()
        AgentAuditLog.objects.all().delete()
        
        # Create run
        sim = LogisticsSimulator.create_simulation_run(
            name=scenario_data["name"],
            total_ticks=scenario_data["total_ticks"]
        )
        
        # Seed scenario
        sim.initialize_scenario(
            carriers_data=scenario_data["carriers"],
            shipments_data=scenario_data["shipments"],
            disruptions_data=scenario_data["disruptions"]
        )
        
        return Response({
            "run": SimulationRunSerializer(sim.run).data,
            "message": f"Simulation initialized for scenario '{scenario_key}'."
        })

class StepSimulationView(APIView):
    def post(self, request, run_id):
        try:
            sim = LogisticsSimulator(run_id)
            result = sim.step()
            return Response(result)
        except SimulationRun.DoesNotExist:
            return Response({"error": "Simulation run not found."}, status=status.HTTP_404_NOT_FOUND)

class GetSimulationStateView(APIView):
    def get(self, request, run_id):
        try:
            run = SimulationRun.objects.get(id=run_id)
            shipments = Shipment.objects.all()
            carriers = Carrier.objects.all()
            events = DisruptionEvent.objects.filter(simulation_run=run)
            logs = AgentAuditLog.objects.filter(simulation_run=run).order_by('-created_at')
            
            return Response({
                "run": SimulationRunSerializer(run).data,
                "shipments": ShipmentSerializer(shipments, many=True).data,
                "carriers": CarrierSerializer(carriers, many=True).data,
                "disruptions": DisruptionEventSerializer(events, many=True).data,
                "logs": AgentAuditLogSerializer(logs, many=True).data
            })
        except SimulationRun.DoesNotExist:
            return Response({"error": "Simulation run not found."}, status=status.HTTP_404_NOT_FOUND)

class SubmitHITLDecisionView(APIView):
    """
    Handles Human-In-The-Loop decisions.
    Approves or overrides the agent's proposed disruption resolution.
    """
    def post(self, request, run_id):
        decision = request.data.get("decision")  # 'APPROVE' or 'OVERRIDE'
        shipment_id = request.data.get("shipment_id")
        proposed_action_str = request.data.get("proposed_action")  # e.g., reassign_carrier(shipment_id='SH-201', carrier_id='CARRIER_B')
        override_carrier_id = request.data.get("override_carrier_id") # if override, new carrier

        try:
            run = SimulationRun.objects.get(id=run_id)
            shipment = Shipment.objects.get(shipment_id=shipment_id)
            
            # Find active breakdown/disruption event for this shipment
            active_event = DisruptionEvent.objects.filter(
                simulation_run=run, 
                target_shipment_id=shipment_id, 
                resolved=False
            ).first()
            
            registry = ToolRegistry(run.id, run.current_tick)
            resolution_notes = ""

            if decision == 'APPROVE':
                # Parse and execute proposed action: reassign_carrier
                # Standard format is: reassign_carrier(shipment_id='...', carrier_id='...')
                # We extract the carrier ID from the string, or run it directly.
                # Since we know the proposed action is reassigning, let's extract the carrier ID:
                import re
                match = re.search(r"carrier_id='([^']+)'", proposed_action_str)
                if match:
                    target_carrier = match.group(1)
                    registry.execute("reassign_carrier", {"shipment_id": shipment_id, "carrier_id": target_carrier})
                    resolution_notes = f"Operator APPROVED agent recommendation: reassigned to {target_carrier}."
                else:
                    return Response({"error": "Failed to parse proposed action string."}, status=status.HTTP_400_BAD_REQUEST)
                
            elif decision == 'OVERRIDE':
                if not override_carrier_id:
                    return Response({"error": "Override requires selecting a carrier."}, status=status.HTTP_400_BAD_REQUEST)
                registry.execute("reassign_carrier", {"shipment_id": shipment_id, "carrier_id": override_carrier_id})
                resolution_notes = f"Operator OVERRODE agent recommendation: manually assigned load to {override_carrier_id}."
            
            else:
                return Response({"error": "Invalid decision. Use APPROVE or OVERRIDE."}, status=status.HTTP_400_BAD_REQUEST)

            # Resolve the event
            if active_event:
                registry.execute("resolve_disruption_event", {
                    "event_id": active_event.id,
                    "resolution_details": resolution_notes
                })
            
            # Log the human action in the agent audit trail
            AgentAuditLog.objects.create(
                simulation_run=run,
                tick=run.current_tick,
                thought="HUMAN OPERATOR INTERVENTION SUBMITTED.",
                action="human_decision",
                action_input=f"Decision: {decision}, Shipment: {shipment_id}",
                observation=resolution_notes
            )
            
            # Advance tick now that HITL blocker is resolved
            run.current_tick += 1
            run.save()

            return Response({
                "status": "RESUMED",
                "message": resolution_notes,
                "current_tick": run.current_tick
            })

        except SimulationRun.DoesNotExist:
            return Response({"error": "Simulation run not found."}, status=status.HTTP_404_NOT_FOUND)
        except Shipment.DoesNotExist:
            return Response({"error": "Shipment not found."}, status=status.HTTP_404_NOT_FOUND)
