# Predefined logistics test scenarios for seeding the simulator.

SCENARIOS = {
    "standard_run": {
        "name": "Standard Route Run",
        "description": "A baseline run with typical regional shipments and a single minor weather delay disruption.",
        "total_ticks": 24,
        "carriers": [
            {
                "carrier_id": "CARRIER_A",
                "name": "FedEx Logistics",
                "reliability": 0.95,
                "sustainability": 0.70,
                "base_rate_per_mile": 1.6
            },
            {
                "carrier_id": "CARRIER_B",
                "name": "EcoFreight Solutions",
                "reliability": 0.88,
                "sustainability": 0.95,
                "base_rate_per_mile": 1.9
            },
            {
                "carrier_id": "CARRIER_C",
                "name": "Swift Carriers",
                "reliability": 0.90,
                "sustainability": 0.60,
                "base_rate_per_mile": 1.3
            }
        ],
        "shipments": [
            {
                "shipment_id": "SH-101",
                "origin": "Chicago Warehouse",
                "destination": "New York Distribution Center",
                "weight": 24000.0,
                "deadline_ticks": 18,
                "route_mileage": 790.0,
                "status": "PENDING"
            },
            {
                "shipment_id": "SH-102",
                "origin": "Atlanta Fulfillment Center",
                "destination": "Miami Retail Store",
                "weight": 18000.0,
                "deadline_ticks": 15,
                "route_mileage": 660.0,
                "status": "PENDING"
            },
            {
                "shipment_id": "SH-103",
                "origin": "Dallas Hub",
                "destination": "Denver Hub",
                "weight": 35000.0,
                "deadline_ticks": 20,
                "route_mileage": 800.0,
                "status": "PENDING"
            }
        ],
        "disruptions": [
            {
                "tick": 6,
                "event_type": "WEATHER_DELAY",
                "target_shipment_id": "SH-101",
                "description": "Blizzard warnings active in Pennsylvania. Route speeds reduced by 50% for SH-101."
            }
        ]
    },
    "supply_chain_chaos": {
        "name": "Supply Chain Chaos Sandbox",
        "description": "An intense scenario featuring cascading breakdowns, spot-market carrier cancellations, and urgent orders.",
        "total_ticks": 48,
        "carriers": [
            {
                "carrier_id": "CARRIER_A",
                "name": "FedEx Logistics",
                "reliability": 0.95,
                "sustainability": 0.70,
                "base_rate_per_mile": 1.6
            },
            {
                "carrier_id": "CARRIER_B",
                "name": "EcoFreight Solutions",
                "reliability": 0.88,
                "sustainability": 0.95,
                "base_rate_per_mile": 1.9
            },
            {
                "carrier_id": "CARRIER_C",
                "name": "Swift Carriers",
                "reliability": 0.90,
                "sustainability": 0.60,
                "base_rate_per_mile": 1.3
            }
        ],
        "shipments": [
            {
                "shipment_id": "SH-201",
                "origin": "Los Angeles Port",
                "destination": "Phoenix Warehouse",
                "weight": 42000.0,
                "deadline_ticks": 12,
                "route_mileage": 370.0,
                "status": "PENDING"
            },
            {
                "shipment_id": "SH-202",
                "origin": "Seattle Fulfillment Center",
                "destination": "Salt Lake City Hub",
                "weight": 12000.0,
                "deadline_ticks": 24,
                "route_mileage": 830.0,
                "status": "PENDING"
            },
            {
                "shipment_id": "SH-203",
                "origin": "Chicago Warehouse",
                "destination": "Detroit Retail Store",
                "weight": 28000.0,
                "deadline_ticks": 10,
                "route_mileage": 280.0,
                "status": "PENDING"
            }
        ],
        "disruptions": [
            {
                "tick": 4,
                "event_type": "TRUCK_BREAKDOWN",
                "target_shipment_id": "SH-201",
                "description": "Engine failure on truck carrying SH-201 near Indio, CA. Vehicle disabled. Re-dispatch or vehicle swap required."
            },
            {
                "tick": 12,
                "event_type": "CARRIER_CANCELLATION",
                "target_shipment_id": "SH-202",
                "description": "Carrier C (Swift Carriers) cancelled transport on SH-202 due to capacity issues. Re-assignment needed."
            },
            {
                "tick": 18,
                "event_type": "RUSH_ORDER",
                "target_shipment_id": None,
                "description": "Urgent retail restock order created for Warehouse West -> Customer Retail East. Immediate carrier match required."
            }
        ]
    }
}
