from django.urls import path
from logistics.views import (
    CreateSimulationView, StepSimulationView, 
    GetSimulationStateView, SubmitHITLDecisionView
)

urlpatterns = [
    path('simulations/create/', CreateSimulationView.as_view(), name='create_simulation'),
    path('simulations/<int:run_id>/step/', StepSimulationView.as_view(), name='step_simulation'),
    path('simulations/<int:run_id>/state/', GetSimulationStateView.as_view(), name='get_simulation_state'),
    path('simulations/<int:run_id>/hitl/', SubmitHITLDecisionView.as_view(), name='submit_hitl_decision'),
]
