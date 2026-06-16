import React, { useState, useEffect, useRef } from 'react';

const API_BASE = "http://localhost:8000/api";

function App() {
  const [scenario, setScenario] = useState("standard_run");
  const [simRun, setSimRun] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [disruptions, setDisruptions] = useState([]);
  const [logs, setLogs] = useState([]);
  
  const [isSimulating, setIsSimulating] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // HITL States
  const [showHITL, setShowHITL] = useState(false);
  const [hitlData, setHitlData] = useState(null);
  const [overrideCarrierId, setOverrideCarrierId] = useState("");

  const intervalRef = useRef(null);

  // Auto-run simulation loop
  useEffect(() => {
    if (isSimulating && simRun && simRun.status !== 'COMPLETED') {
      intervalRef.current = setInterval(() => {
        handleStep(simRun.id, true);
      }, 1800);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isSimulating, simRun]);

  const initSimulation = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/simulations/create/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario })
      });
      const data = await res.json();
      setSimRun(data.run);
      await fetchState(data.run.id);
      setIsSimulating(false);
      setShowHITL(false);
      setHitlData(null);
    } catch (err) {
      console.error("Error creating simulation:", err);
      alert("Failed to initialize simulation. Make sure Django backend is running at localhost:8000.");
    } finally {
      setLoading(false);
    }
  };

  const fetchState = async (runId) => {
    try {
      const res = await fetch(`${API_BASE}/simulations/${runId}/state/`);
      const data = await res.json();
      setSimRun(data.run);
      setShipments(data.shipments);
      setCarriers(data.carriers);
      setDisruptions(data.disruptions);
      setLogs(data.logs);
      
      // Auto-open HITL if agent paused
      const activeBreakdowns = data.disruptions.filter(d => !d.resolved && d.event_type === 'TRUCK_BREAKDOWN');
      const lastAudit = data.logs[0];
      if (activeBreakdowns.length > 0 && lastAudit && lastAudit.action === 'request_human_override') {
        try {
          const actionInput = JSON.parse(lastAudit.observation);
          if (actionInput.status === 'PAUSED_FOR_HITL') {
            setHitlData({
              shipment_id: actionInput.shipment_id,
              reason: actionInput.reason,
              proposed_action: actionInput.proposed_action
            });
            setShowHITL(true);
            setIsSimulating(false);
          }
        } catch(e) {
          // Fallback parsing if JSON wasn't returned directly
          setHitlData({
            shipment_id: activeBreakdowns[0].target_shipment_id,
            reason: activeBreakdowns[0].description,
            proposed_action: "reassign_carrier(shipment_id='" + activeBreakdowns[0].target_shipment_id + "', carrier_id='CARRIER_B')"
          });
          setShowHITL(true);
          setIsSimulating(false);
        }
      }
    } catch (err) {
      console.error("Error fetching state:", err);
    }
  };

  const handleStep = async (runId, isAuto = false) => {
    if (loading) return;
    try {
      const res = await fetch(`${API_BASE}/simulations/${runId}/step/`, {
        method: "POST"
      });
      const data = await res.json();
      
      if (data.error) {
        setIsSimulating(false);
        alert(data.error);
        return;
      }

      if (data.hitl_paused) {
        setIsSimulating(false);
        setHitlData(data.decision_required);
        setShowHITL(true);
      }

      await fetchState(runId);
      
      if (data.status === 'COMPLETED') {
        setIsSimulating(false);
      }
    } catch (err) {
      console.error("Error stepping simulation:", err);
      setIsSimulating(false);
    }
  };

  const submitHITL = async (decision) => {
    if (!simRun || !hitlData) return;
    setLoading(true);
    try {
      const payload = {
        decision,
        shipment_id: hitlData.shipment_id,
        proposed_action: hitlData.proposed_action,
        override_carrier_id: decision === 'OVERRIDE' ? overrideCarrierId : undefined
      };

      const res = await fetch(`${API_BASE}/simulations/${simRun.id}/hitl/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      setShowHITL(false);
      setHitlData(null);
      setOverrideCarrierId("");
      await fetchState(simRun.id);
      
      // Auto-resume if it was running before
      setIsSimulating(true);
    } catch (err) {
      console.error("Error submitting decision:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">IFS</div>
          <h1 className="brand-name">IFS.ai Logistics Sandbox</h1>
          <span className="brand-badge">Agentic Dispatch</span>
        </div>
        <div className="controls-header">
          <select 
            value={scenario} 
            onChange={(e) => setScenario(e.target.value)}
            disabled={isSimulating}
          >
            <option value="standard_run">Scenario: Standard Route Run</option>
            <option value="supply_chain_chaos">Scenario: Supply Chain Chaos</option>
          </select>
          <button className="btn btn-primary" onClick={initSimulation} disabled={loading}>
            Initialize Sandbox
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="dashboard-grid">
        {/* Sidebar Controls & KPIs */}
        <section className="sidebar">
          <h2 className="panel-title">Control Center</h2>
          
          <div className="control-group">
            <button 
              className="btn btn-primary" 
              onClick={() => handleStep(simRun.id)}
              disabled={!simRun || isSimulating || simRun.status === 'COMPLETED' || showHITL}
            >
              Step 1 Hour (Manual)
            </button>
            <button 
              className={`btn ${isSimulating ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => setIsSimulating(!isSimulating)}
              disabled={!simRun || simRun.status === 'COMPLETED' || showHITL}
            >
              {isSimulating ? "Pause Simulation" : "Run Simulation Auto"}
            </button>
          </div>

          <h2 className="panel-title" style={{ marginTop: '20px' }}>Simulation KPIs</h2>
          <div className="kpi-container">
            <div className="kpi-card">
              <span className="kpi-label">Total Dispatch Cost</span>
              <span className="kpi-value">
                ${simRun ? simRun.total_cost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : "0.00"}
              </span>
            </div>
            <div className="kpi-card sla">
              <span className="kpi-label">SLA Compliance</span>
              <span className="kpi-value">
                {simRun ? (simRun.sla_compliance * 100).toFixed(0) : "100"}%
              </span>
            </div>
            <div className="kpi-card emissions">
              <span className="kpi-label">CO2 Footprint</span>
              <span className="kpi-value">
                {simRun ? simRun.emissions.toFixed(1) : "0.0"} kg
              </span>
            </div>
          </div>

          <h2 className="panel-title" style={{ marginTop: '20px' }}>Carrier Registry</h2>
          <div className="control-group" style={{ gap: '8px' }}>
            {carriers.map(c => (
              <div key={c.carrier_id} style={{ fontSize: '0.85rem', padding: '10px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: 'var(--text-muted)' }}>Rate: ${c.base_rate_per_mile}/mi</div>
                <div style={{ color: 'var(--text-muted)' }}>SLA Trust: {c.reliability * 100}%</div>
                <div style={{ color: 'var(--accent-neon-green)' }}>Eco: {c.sustainability * 100}%</div>
              </div>
            ))}
          </div>
        </section>

        {/* Center Panel (Timeline & Shipments) */}
        <section className="center-panel">
          <div className="section-header">
            <h2>Network Status</h2>
            <div className="tick-display">
              VIRTUAL TIME: Hour {simRun ? simRun.current_tick : 0} of {simRun ? simRun.total_ticks : 48}
            </div>
          </div>

          {/* Timeline Tracker */}
          <div className="simulation-timeline">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Start</span>
            <div className="timeline-track">
              <div 
                className="timeline-progress" 
                style={{ width: `${simRun ? (simRun.current_tick / simRun.total_ticks) * 100 : 0}%` }}
              ></div>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Hour {simRun ? simRun.total_ticks : 48}</span>
          </div>

          {/* Shipment Cards */}
          <div className="shipment-list">
            {shipments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                Initialize the sandbox to generate logistics shipment requests.
              </div>
            ) : (
              shipments.map(s => {
                const isActiveDelay = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'WEATHER_DELAY');
                const isActiveBreakdown = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'TRUCK_BREAKDOWN');
                let cardClass = "shipment-card";
                if (isActiveBreakdown) cardClass += " breakdown";
                else if (isActiveDelay) cardClass += " delayed";

                return (
                  <div key={s.shipment_id} className={cardClass}>
                    <div className="shipment-top">
                      <div className="shipment-id-badge">{s.shipment_id}</div>
                      <div className="shipment-route">
                        <span>{s.origin}</span>
                        <span className="route-arrow">→</span>
                        <span>{s.destination}</span>
                      </div>
                      <span className={`status-badge ${s.status.toLowerCase()}`}>{s.status.replace('_', ' ')}</span>
                    </div>

                    {/* Progress Fill */}
                    <div className="shipment-progress-section">
                      <div className="shipment-progress-bar">
                        <div 
                          className={`shipment-progress-fill ${s.status === 'DELAYED' ? 'delayed' : ''}`}
                          style={{ width: `${s.current_position_progress * 100}%` }}
                        ></div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span>Progress: {(s.current_position_progress * 100).toFixed(0)}%</span>
                        <span>ETA: Hour {s.eta_ticks} (Deadline: Hour {s.deadline_ticks})</span>
                      </div>
                    </div>

                    {/* Detail Grid */}
                    <div className="shipment-details-grid">
                      <div className="detail-item">
                        <span className="detail-label">Carrier</span>
                        <span className="detail-value highlight">{s.carrier_name || "Unassigned"}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Weight</span>
                        <span className="detail-value">{(s.weight / 2000).toFixed(1)} tons</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Distance</span>
                        <span className="detail-value">{s.route_mileage} miles</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Est. Cost</span>
                        <span className="detail-value">${s.cost.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Sidebar (Agent Monologue Logs) */}
        <section className="agent-panel">
          <div className="agent-header">
            <div className={`agent-status-dot ${isSimulating ? 'thinking' : (simRun ? 'idle' : 'idle')}`}></div>
            <h2 className="panel-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Agent Monologue</h2>
          </div>

          <div className="agent-logs-container">
            {logs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Agent reasoning logs will populate once disruptions occur or routing tasks commence.
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="log-entry">
                  <div className="log-meta">
                    <span>HOUR {log.tick}</span>
                    <span>AGENT DECISION TRACE</span>
                  </div>
                  <div className="log-thought">
                    <strong>Reasoning:</strong> {log.thought}
                  </div>
                  {log.action && log.action !== 'None' && (
                    <div className="log-action-block">
                      <div className="log-action-title">Executed Tool: {log.action}()</div>
                      <div className="log-action-input">Args: {log.action_input}</div>
                    </div>
                  )}
                  {log.observation && (
                    <div className="log-observation">
                      <strong>Observation:</strong> {log.observation}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {/* Human-in-the-Loop Modal */}
      {showHITL && hitlData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-header-icon">!</div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Human-in-the-Loop Override Required</h3>
            </div>
            
            <div className="modal-body">
              <div>
                <span className="modal-label">Affected Shipment</span>
                <div className="modal-box" style={{ fontWeight: 600 }}>{hitlData.shipment_id}</div>
              </div>
              
              <div>
                <span className="modal-label">Disruption Reason</span>
                <div className="modal-box" style={{ color: 'var(--accent-yellow)', borderColor: 'var(--accent-yellow)' }}>
                  {hitlData.reason}
                </div>
              </div>

              <div>
                <span className="modal-label">Agent Recommended Action</span>
                <div className="modal-box">
                  <code className="proposed-action-code">{hitlData.proposed_action}</code>
                </div>
              </div>

              <div className="override-selection-section">
                <span className="modal-label">Or, Manually Override Carrier Assignment</span>
                <select 
                  value={overrideCarrierId} 
                  onChange={(e) => setOverrideCarrierId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">-- Select Alternate Carrier to Override --</option>
                  {carriers.map(c => (
                    <option key={c.carrier_id} value={c.carrier_id}>
                      {c.name} (${c.base_rate_per_mile}/mi, Reliability: {c.reliability*100}%)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn" 
                style={{ background: 'transparent', borderColor: 'var(--border-color)' }}
                onClick={() => submitHITL('APPROVE')}
              >
                Approve Recommendation
              </button>
              <button 
                className="btn btn-primary"
                disabled={!overrideCarrierId}
                onClick={() => submitHITL('OVERRIDE')}
              >
                Execute Manual Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
