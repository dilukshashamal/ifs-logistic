from django.test import TestCase
from logistics.models import Carrier, Shipment, SimulationRun, DisruptionEvent, AgentAuditLog
from simulator.engine import LogisticsSimulator
from rag.vector_store import rag_engine

class RAGSearchTestCase(TestCase):
    def test_rag_search_hits(self):
        """Verifies that the custom RAG search finds matches for key search terms."""
        results = rag_engine.search("FedEx delay penalties", top_k=1)
        self.assertTrue(len(results) > 0)
        self.assertEqual(results[0]['doc']['id'], 'doc_sla_fedex')
        self.assertTrue("FedEx SLA" in results[0]['doc']['content'])

        results_hazmat = rag_engine.search("Hazmat routing Pennsylvania Turnpike", top_k=1)
        self.assertEqual(results_hazmat[0]['doc']['id'], 'doc_reg_hazmat')

class SimulationEngineTestCase(TestCase):
    def setUp(self):
        # Sample data for setup
        self.carriers = [
            {"carrier_id": "C_TEST", "name": "Test Carrier", "reliability": 0.9, "sustainability": 0.7, "base_rate_per_mile": 1.5}
        ]
        self.shipments = [
            {"shipment_id": "S_TEST", "origin": "Origin", "destination": "Dest", "weight": 10000.0, "deadline_ticks": 10, "route_mileage": 100.0, "carrier_id": "C_TEST", "status": "PENDING"}
        ]
        self.disruptions = [
            {"tick": 2, "event_type": "WEATHER_DELAY", "target_shipment_id": "S_TEST", "description": "Rain delay"}
        ]

    def test_simulation_initialization(self):
        """Tests that the simulator successfully seeds carriers, shipments, and scheduled events."""
        sim = LogisticsSimulator.create_simulation_run("Test Run", total_ticks=12)
        sim.initialize_scenario(self.carriers, self.shipments, self.disruptions)
        
        self.assertEqual(Carrier.objects.count(), 1)
        self.assertEqual(Shipment.objects.count(), 1)
        self.assertEqual(DisruptionEvent.objects.count(), 1)
        self.assertEqual(sim.run.status, 'IDLE')
        self.assertEqual(sim.run.current_tick, 0)

    def test_simulation_step_progress(self):
        """Verifies that shipments progress on step, and transition from ASSIGNED to IN_TRANSIT, then to DELIVERED."""
        sim = LogisticsSimulator.create_simulation_run("Step Run", total_ticks=5)
        
        # Seed shipment with short route mileage so it delivers fast
        short_shipments = [
            {"shipment_id": "S_SHORT", "origin": "A", "destination": "B", "weight": 5000.0, "deadline_ticks": 5, "route_mileage": 50.0, "carrier_id": "C_TEST", "status": "ASSIGNED"}
        ]
        sim.initialize_scenario(self.carriers, short_shipments, [])
        
        # Step 1: ASSIGNED -> IN_TRANSIT. Mileage is 50, speed is 50/50 = 1.0 progress per tick
        result = sim.step()
        
        # Refresh from database
        shipment = Shipment.objects.get(shipment_id="S_SHORT")
        self.assertEqual(shipment.status, 'DELIVERED')
        self.assertEqual(shipment.current_position_progress, 1.0)
        self.assertEqual(shipment.cost, 75.0)  # 50 miles * 1.5 rate
        self.assertEqual(result["kpis"]["total_cost"], 75.0)
        self.assertEqual(sim.run.current_tick, 1)

    def test_agent_triggering_on_disruption(self):
        """Verifies that disruptions trigger the Agent and generate AgentAuditLogs."""
        sim = LogisticsSimulator.create_simulation_run("Disruption Run", total_ticks=10)
        
        # Seed scenario where weather delay triggers at tick 1
        disruptions = [
            {"tick": 1, "event_type": "WEATHER_DELAY", "target_shipment_id": "S_TEST", "description": "Rain storm delay"}
        ]
        sim.initialize_scenario(self.carriers, self.shipments, disruptions)
        
        # Step 0: Initial dispatch. Agent runs and assigns carrier (already done or run now)
        sim.step() # Tick 0 -> 1. Shipment becomes IN_TRANSIT
        
        # Step 1: Tick 1. Weather disruption triggers. Agent should be invoked.
        result = sim.step() # Tick 1 -> 2
        
        self.assertTrue(result["agent_invoked"])
        
        # Verify AgentAuditLog was created
        audit_logs = AgentAuditLog.objects.filter(simulation_run=sim.run)
        self.assertTrue(audit_logs.count() > 0)
        self.assertTrue(any("resolve" in log.action for log in audit_logs))
