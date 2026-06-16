from django.db import models

class Carrier(models.Model):
    carrier_id = models.CharField(max_length=50, primary_key=True)
    name = models.CharField(max_length=100)
    reliability = models.FloatField(default=1.0)  # 0.0 to 1.0 (historical SLA compliance)
    sustainability = models.FloatField(default=0.8) # Carbon efficiency rating (0.0 to 1.0)
    base_rate_per_mile = models.FloatField(default=1.5) # rate per mile in USD

    def __str__(self):
        return f"{self.name} ({self.carrier_id})"

class Shipment(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending Assignment'),
        ('ASSIGNED', 'Assigned to Carrier'),
        ('IN_TRANSIT', 'In Transit'),
        ('DELAYED', 'Delayed'),
        ('DELIVERED', 'Delivered'),
        ('CANCELLED', 'Cancelled'),
    ]

    shipment_id = models.CharField(max_length=50, primary_key=True)
    origin = models.CharField(max_length=100)
    destination = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    carrier = models.ForeignKey(Carrier, null=True, blank=True, on_delete=models.SET_NULL)
    weight = models.FloatField()  # in lbs
    cost = models.FloatField(default=0.0)  # Total cost in USD
    eta_ticks = models.IntegerField(default=0)  # Estimated arrival time in simulator ticks
    deadline_ticks = models.IntegerField(default=100)  # SLA deadline in simulator ticks
    route_mileage = models.FloatField(default=0.0)  # total trip miles
    current_position_progress = models.FloatField(default=0.0)  # 0.0 to 1.0
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.shipment_id}: {self.origin} -> {self.destination} ({self.status})"

class SimulationRun(models.Model):
    STATUS_CHOICES = [
        ('IDLE', 'Idle'),
        ('RUNNING', 'Running'),
        ('COMPLETED', 'Completed'),
        ('FAILED', 'Failed'),
    ]

    name = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='IDLE')
    current_tick = models.IntegerField(default=0)
    total_ticks = models.IntegerField(default=48)  # Default 48-hour simulation run
    total_cost = models.FloatField(default=0.0)
    sla_compliance = models.FloatField(default=1.0)  # percentage of on-time deliveries (0.0 to 1.0)
    emissions = models.FloatField(default=0.0)  # total carbon footprint metric
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"SimRun #{self.id}: {self.name} ({self.status}, Tick: {self.current_tick}/{self.total_ticks})"

class DisruptionEvent(models.Model):
    EVENT_CHOICES = [
        ('TRUCK_BREAKDOWN', 'Truck Breakdown'),
        ('WEATHER_DELAY', 'Severe Weather Delay'),
        ('RUSH_ORDER', 'Sudden High Priority Order'),
        ('CARRIER_CANCELLATION', 'Carrier Cancellation'),
    ]

    simulation_run = models.ForeignKey(SimulationRun, on_delete=models.CASCADE, related_name='events')
    tick = models.IntegerField()  # The tick when the disruption occurred
    event_type = models.CharField(max_length=30, choices=EVENT_CHOICES)
    target_shipment_id = models.CharField(max_length=50, null=True, blank=True)
    description = models.TextField()
    resolved = models.BooleanField(default=False)
    resolved_at_tick = models.IntegerField(null=True, blank=True)
    resolution_details = models.TextField(null=True, blank=True)

    def __str__(self):
        status_str = "Resolved" if self.resolved else "Active"
        return f"{self.event_type} @ tick {self.tick} - {status_str}"

class AgentAuditLog(models.Model):
    simulation_run = models.ForeignKey(SimulationRun, on_delete=models.CASCADE, related_name='logs')
    tick = models.IntegerField()
    thought = models.TextField()
    action = models.CharField(max_length=100)  # Tool name or decision type
    action_input = models.TextField()         # Arguments passed to tool/decision
    observation = models.TextField()          # Output of tool execution
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"AgentLog SimRun #{self.simulation_run.id} @ tick {self.tick} - Action: {self.action}"
