from rest_framework import serializers
from logistics.models import Carrier, Shipment, SimulationRun, DisruptionEvent, AgentAuditLog

class CarrierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Carrier
        fields = '__all__'

class ShipmentSerializer(serializers.ModelSerializer):
    carrier_name = serializers.CharField(source='carrier.name', read_only=True)
    
    class Meta:
        model = Shipment
        fields = '__all__'

class SimulationRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = SimulationRun
        fields = '__all__'

class DisruptionEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = DisruptionEvent
        fields = '__all__'

class AgentAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentAuditLog
        fields = '__all__'
