import json
from logistics.models import Carrier, Shipment, DisruptionEvent, AgentAuditLog
from rag.vector_store import rag_engine

class ToolRegistry:
    def __init__(self, run_id, tick):
        self.run_id = run_id
        self.tick = tick
        self._tools = {
            "query_shipment_details": self.query_shipment_details,
            "get_available_carriers": self.get_available_carriers,
            "reassign_carrier": self.reassign_carrier,
            "query_carrier_contract_sla": self.query_carrier_contract_sla,
            "request_human_override": self.request_human_override,
            "resolve_disruption_event": self.resolve_disruption_event
        }

    def execute(self, tool_name, arguments):
        """Executes a tool by name with safety checks."""
        if tool_name not in self._tools:
            return f"Error: Tool '{tool_name}' not found."
        try:
            # Parse arguments if passed as JSON string
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    return f"Error: Arguments must be a valid JSON object. Got string: {arguments}"
            
            return self._tools[tool_name](**arguments)
        except Exception as e:
            return f"Error executing tool {tool_name}: {str(e)}"

    def get_tool_definitions(self):
        """Returns JSON schema definitions of the tools for the LLM prompt."""
        return [
            {
                "name": "query_shipment_details",
                "description": "Retrieves the full details of a specific shipment including route mileage, weight, current status, and assigned carrier.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "shipment_id": {"type": "string", "description": "The unique ID of the shipment."}
                    },
                    "required": ["shipment_id"]
                }
            },
            {
                "name": "get_available_carriers",
                "description": "Lists all logistics carriers with their base rates per mile, sustainability (carbon efficiency), and reliability scores.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "reassign_carrier",
                "description": "Assigns or re-routes a shipment to a new carrier. Resets progress if it was stalled by breakdown, and recalculates shipping cost.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "shipment_id": {"type": "string", "description": "ID of the shipment to update."},
                        "carrier_id": {"type": "string", "description": "ID of the new carrier."}
                    },
                    "required": ["shipment_id", "carrier_id"]
                }
            },
            {
                "name": "query_carrier_contract_sla",
                "description": "Searches the carrier SLA agreements and company SOPs (via RAG) to find penalties, weather exceptions, or breakdown policies.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search keyword or natural language query (e.g. 'FedEx delay penalty')."}
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "request_human_override",
                "description": "Suspends the agent execution loop and prompts a human operator to approve or override a decision. Use this for high-cost decisions (cost variance > $1,000) or high-risk delays.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "shipment_id": {"type": "string", "description": "ID of the affected shipment."},
                        "reason": {"type": "string", "description": "Reason why human approval is required."},
                        "proposed_action": {"type": "string", "description": "The action the agent proposes taking if approved."}
                    },
                    "required": ["shipment_id", "reason", "proposed_action"]
                }
            },
            {
                "name": "resolve_disruption_event",
                "description": "Marks an active disruption event as resolved and logs the details of the resolution.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "event_id": {"type": "integer", "description": "ID of the disruption event to resolve."},
                        "resolution_details": {"type": "string", "description": "Brief notes on how the event was resolved."}
                    },
                    "required": ["event_id", "resolution_details"]
                }
            }
        ]

    # --- Tool Implementations ---

    def query_shipment_details(self, shipment_id):
        try:
            sh = Shipment.objects.get(shipment_id=shipment_id)
            return json.dumps({
                "shipment_id": sh.shipment_id,
                "origin": sh.origin,
                "destination": sh.destination,
                "status": sh.status,
                "carrier_id": sh.carrier.carrier_id if sh.carrier else None,
                "weight": sh.weight,
                "cost": sh.cost,
                "eta_ticks": sh.eta_ticks,
                "deadline_ticks": sh.deadline_ticks,
                "route_mileage": sh.route_mileage,
                "current_position_progress": sh.current_position_progress
            })
        except Shipment.DoesNotExist:
            return f"Error: Shipment '{shipment_id}' not found."

    def get_available_carriers(self):
        carriers = Carrier.objects.all()
        return json.dumps([
            {
                "carrier_id": c.carrier_id,
                "name": c.name,
                "reliability": c.reliability,
                "sustainability": c.sustainability,
                "base_rate_per_mile": c.base_rate_per_mile
            } for c in carriers
        ])

    def reassign_carrier(self, shipment_id, carrier_id):
        try:
            sh = Shipment.objects.get(shipment_id=shipment_id)
            c = Carrier.objects.get(carrier_id=carrier_id)
            
            # Record current details for comparison
            old_carrier = sh.carrier.carrier_id if sh.carrier else "None"
            
            # Apply changes
            sh.carrier = c
            sh.status = 'ASSIGNED'  # resets it from delayed/pending to moving
            sh.cost = sh.route_mileage * c.base_rate_per_mile
            
            # If it was in progress but broke down, we reset progress to 0.0 or penalize it
            if sh.current_position_progress > 0 and sh.current_position_progress < 1.0:
                # Re-assignment mid-route takes 2 ticks prep and resets progress to last checkpoint (e.g. 0.0 for simplicity)
                sh.current_position_progress = 0.0
                sh.eta_ticks = self.tick + int(sh.route_mileage / 50.0) + 2
            else:
                sh.eta_ticks = self.tick + int(sh.route_mileage / 50.0)

            sh.save()
            return f"Success: Reassigned shipment '{shipment_id}' from Carrier '{old_carrier}' to '{carrier_id}'. New ETA: tick {sh.eta_ticks}. New Cost: ${sh.cost:.2f}."
        except Shipment.DoesNotExist:
            return f"Error: Shipment '{shipment_id}' not found."
        except Carrier.DoesNotExist:
            return f"Error: Carrier '{carrier_id}' not found."

    def query_carrier_contract_sla(self, query):
        results = rag_engine.search(query, top_k=2)
        formatted = []
        for r in results:
            formatted.append(f"Document: {r['doc']['title']} (Confidence: {r['score']})\nContent: {r['doc']['content']}")
        return "\n\n".join(formatted)

    def request_human_override(self, shipment_id, reason, proposed_action):
        # In a real app, this writes to a notifications/HITL queue.
        # We will return a special response that our agent loop detects to halt simulation.
        # This will be logged as an audit log.
        return json.dumps({
            "status": "PAUSED_FOR_HITL",
            "shipment_id": shipment_id,
            "reason": reason,
            "proposed_action": proposed_action
        })

    def resolve_disruption_event(self, event_id, resolution_details):
        try:
            ev = DisruptionEvent.objects.get(id=event_id, simulation_run_id=self.run_id)
            ev.resolved = True
            ev.resolved_at_tick = self.tick
            ev.resolution_details = resolution_details
            ev.save()
            return f"Success: Disruption event #{event_id} marked as resolved."
        except DisruptionEvent.DoesNotExist:
            return f"Error: Disruption event #{event_id} not found for simulation run {self.run_id}."
