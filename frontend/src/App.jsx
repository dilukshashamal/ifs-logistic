import React, { useState, useEffect, useRef } from 'react';

const API_BASE = "http://localhost:8000/api";

// Real-world shipment metadata map (Customer Account, Cargo details, Invoice Value, Priority)
const REAL_WORLD_METADATA = {
  "SH-101": { customer: "Walmart Inc.", cargo: "Consumer Electronics", value: "$142,500", priority: "Critical SLA" },
  "SH-102": { customer: "Target Corp.", cargo: "Fresh Apparel", value: "$85,000", priority: "Standard SLA" },
  "SH-103": { customer: "Denver Logistics Ltd", cargo: "Automotive Parts", value: "$210,000", priority: "Standard SLA" },
  "SH-201": { customer: "Amazon Fulfillment", cargo: "Pharmacy Cold-chain", value: "$350,000", priority: "Critical SLA" },
  "SH-202": { customer: "Costco Wholesalers", cargo: "Dry Groceries", value: "$62,000", priority: "Standard SLA" },
  "SH-203": { customer: "Home Depot", cargo: "Building Materials", value: "$94,000", priority: "Critical SLA" }
};

// SVG Telemetry map hub coordinates (Visual grid: 800 x 350)
const CITY_COORDINATES = {
  "Chicago Warehouse": { x: 530, y: 100, label: "Chicago" },
  "New York Distribution Center": { x: 710, y: 90, label: "New York" },
  "Atlanta Fulfillment Center": { x: 570, y: 220, label: "Atlanta" },
  "Miami Retail Store": { x: 650, y: 310, label: "Miami" },
  "Dallas Hub": { x: 410, y: 250, label: "Dallas" },
  "Denver Hub": { x: 300, y: 130, label: "Denver" },
  "Los Angeles Port": { x: 90, y: 210, label: "Los Angeles" },
  "Phoenix Warehouse": { x: 160, y: 220, label: "Phoenix" },
  "Seattle Fulfillment Center": { x: 80, y: 40, label: "Seattle" },
  "Salt Lake City Hub": { x: 200, y: 110, label: "Salt Lake City" },
  "Detroit Retail Store": { x: 590, y: 90, label: "Detroit" },
  "Warehouse West": { x: 220, y: 170, label: "Warehouse West" },
  "Customer Retail East": { x: 680, y: 190, label: "Retail East" }
};

function App() {
  const [scenario, setScenario] = useState("standard_run");
  const [simRun, setSimRun] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [disruptions, setDisruptions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [costHistory, setCostHistory] = useState([]);
  
  const [isSimulating, setIsSimulating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  
  // Mobile / Tablet Responsive States
  const [activeTab, setActiveTab] = useState("dashboard"); // "dashboard", "shipments", "agent"
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Guided Tour State (0 = inactive, 1-5 = active step)
  const [tourStep, setTourStep] = useState(0);

  // Contextual Help States
  const [hoveredHelpPanel, setHoveredHelpPanel] = useState(null);

  // Manual RAG Contract Search States
  const [ragQuery, setRagQuery] = useState("");
  const [ragResults, setRagResults] = useState([]);
  const [ragLoading, setRagLoading] = useState(false);
  
  // HITL States
  const [showHITL, setShowHITL] = useState(false);
  const [hitlData, setHitlData] = useState(null);
  const [selectedCarrierId, setSelectedCarrierId] = useState("");

  // Log auto-scroll Ref & State
  const logsContainerRef = useRef(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

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

  // Handle auto-scroll check
  const handleLogsScroll = () => {
    const container = logsContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    setShowJumpToLatest(!isNearBottom);
  };

  const scrollToBottom = () => {
    const container = logsContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setShowJumpToLatest(false);
    }
  };

  // Auto scroll when logs update (if user is at bottom)
  useEffect(() => {
    if (!showJumpToLatest) {
      scrollToBottom();
    }
  }, [logs]);

  const initSimulation = async (selectedScenario = scenario) => {
    setLoading(true);
    setApiError(null);
    setCostHistory([]);
    try {
      const res = await fetch(`${API_BASE}/simulations/create/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: selectedScenario })
      });
      if (!res.ok) throw new Error("Connection failed");
      const data = await res.json();
      setSimRun(data.run);
      await fetchState(data.run.id);
      setIsSimulating(false);
      setShowHITL(false);
      setHitlData(null);
      setRagResults([]);
      setRagQuery("");
    } catch (err) {
      console.error("Error creating simulation:", err);
      setApiError("Failed to initialize simulation. Make sure Django backend is running at localhost:8000.");
    } finally {
      setLoading(false);
    }
  };

  const fetchState = async (runId) => {
    try {
      const res = await fetch(`${API_BASE}/simulations/${runId}/state/`);
      if (!res.ok) throw new Error("Connection failed");
      const data = await res.json();
      setSimRun(data.run);
      setShipments(data.shipments);
      setCarriers(data.carriers);
      setDisruptions(data.disruptions);
      
      // Update cost history
      setCostHistory(prev => {
        const tick = data.run.current_tick;
        const cost = data.run.total_cost;
        if (prev.some(h => h.tick === tick)) return prev;
        return [...prev, { tick, cost }].sort((a, b) => a.tick - b.tick);
      });
      
      // Prune logs in DOM if exceeding 100 to maintain client scalability
      const incomingLogs = data.logs || [];
      const prunedLogs = incomingLogs.length > 100 ? incomingLogs.slice(0, 100) : incomingLogs;
      setLogs(prunedLogs);
      
      // Auto-open HITL if agent paused
      const activeBreakdowns = data.disruptions.filter(d => !d.resolved && d.event_type === 'TRUCK_BREAKDOWN');
      const lastAudit = data.logs[0];
      if (activeBreakdowns.length > 0 && lastAudit && lastAudit.action === 'request_human_override') {
        try {
          const actionInput = JSON.parse(lastAudit.observation);
          if (actionInput.status === 'PAUSED_FOR_HITL') {
            const proposedCarrierId = extractCarrierId(actionInput.proposed_action);
            setHitlData({
              shipment_id: actionInput.shipment_id,
              reason: actionInput.reason,
              proposed_action: actionInput.proposed_action,
              proposed_carrier_id: proposedCarrierId
            });
            setSelectedCarrierId(proposedCarrierId);
            setShowHITL(true);
            setIsSimulating(false);
          }
        } catch(e) {
          // Fallback parsing if JSON wasn't returned directly
          const proposedCarrierId = extractCarrierId(activeBreakdowns[0].description);
          setHitlData({
            shipment_id: activeBreakdowns[0].target_shipment_id,
            reason: activeBreakdowns[0].description,
            proposed_action: "reassign_carrier(shipment_id='" + activeBreakdowns[0].target_shipment_id + "', carrier_id='CARRIER_B')",
            proposed_carrier_id: proposedCarrierId || 'CARRIER_B'
          });
          setSelectedCarrierId(proposedCarrierId || 'CARRIER_B');
          setShowHITL(true);
          setIsSimulating(false);
        }
      }
    } catch (err) {
      console.error("Error fetching state:", err);
      setApiError("Lost connection to simulation server.");
    }
  };

  const extractCarrierId = (str) => {
    if (!str) return '';
    const match = str.match(/carrier_id='([^']+)'/) || str.match(/carrier_id="([^"]+)"/) || str.match(/to (CARRIER_[A-Z])/);
    return match ? match[1] : '';
  };

  const handleStep = async (runId, isAuto = false) => {
    if (loading) return;
    try {
      const res = await fetch(`${API_BASE}/simulations/${runId}/step/`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Step failed");
      const data = await res.json();
      
      if (data.error) {
        setIsSimulating(false);
        setApiError(data.error);
        return;
      }

      if (data.hitl_paused) {
        setIsSimulating(false);
        const proposedCarrierId = extractCarrierId(data.decision_required.proposed_action);
        setHitlData({
          ...data.decision_required,
          proposed_carrier_id: proposedCarrierId
        });
        setSelectedCarrierId(proposedCarrierId);
        setShowHITL(true);
      }

      await fetchState(runId);
      
      if (data.status === 'COMPLETED') {
        setIsSimulating(false);
      }
    } catch (err) {
      console.error("Error stepping simulation:", err);
      setIsSimulating(false);
      setApiError("Failed to step simulation clock.");
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
        override_carrier_id: decision === 'OVERRIDE' ? selectedCarrierId : undefined
      };

      const res = await fetch(`${API_BASE}/simulations/${simRun.id}/hitl/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("HITL submission failed");
      
      setShowHITL(false);
      setHitlData(null);
      await fetchState(simRun.id);
      
      // Resume simulation automatically
      setIsSimulating(true);
    } catch (err) {
      console.error("Error submitting decision:", err);
      setApiError("Failed to submit operator override decision.");
    } finally {
      setLoading(false);
    }
  };

  // Live RAG Contract search query execution
  const executeContractSearch = async () => {
    if (!ragQuery.trim()) return;
    setRagLoading(true);
    try {
      const res = await fetch(`${API_BASE}/contracts/search/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: ragQuery })
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setRagResults(data.results || []);
    } catch (err) {
      console.error("RAG search error:", err);
    } finally {
      setRagLoading(false);
    }
  };

  // Helper icons for statuses (Double-Coding requirement)
  const getStatusIcon = (status) => {
    switch(status.toUpperCase()) {
      case 'PENDING': return '⏳';
      case 'ASSIGNED': return '🛡️';
      case 'IN_TRANSIT': return '🚚';
      case 'DELAYED': return '⚠️';
      case 'DELIVERED': return '✅';
      case 'CANCELLED': return '❌';
      default: return '📦';
    }
  };

  // Helper icons for disruption types
  const getDisruptionIcon = (type) => {
    switch(type) {
      case 'TRUCK_BREAKDOWN': return '🔧';
      case 'WEATHER_DELAY': return '⛈️';
      case 'RUSH_ORDER': return '🔥';
      case 'CARRIER_CANCELLATION': return '🚫';
      default: return '⚠️';
    }
  };

  // Helper to fetch augmented customer metadata
  const getShipmentMeta = (shipmentId) => {
    if (REAL_WORLD_METADATA[shipmentId]) return REAL_WORLD_METADATA[shipmentId];
    // Dynamic generation for rush orders
    return {
      customer: "SLA Urgent Spot-Market",
      cargo: "Emergency Logistics Supplies",
      value: "$125,000",
      priority: "Critical SLA"
    };
  };

  // Reset current run to configuration screen
  const handleReset = () => {
    setSimRun(null);
    setShipments([]);
    setCarriers([]);
    setDisruptions([]);
    setLogs([]);
    setCostHistory([]);
    setIsSimulating(false);
    setShowHITL(false);
    setHitlData(null);
    setApiError(null);
    setTourStep(0);
  };

  // Render Tour overlay box coordinates
  const renderTourTooltip = () => {
    if (tourStep === 0) return null;

    let title = "";
    let desc = "";
    let style = {};

    switch(tourStep) {
      case 1:
        title = "AI Copilot Control Tower";
        desc = "Welcome! This is the Autonomous Dispatch Copilot. Choose one of the regional shipping corridors to launch active telemetry monitoring.";
        style = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
        break;
      case 2:
        title = "Dispatcher Control Tower";
        desc = "Once active, use this console to advance the shift hour manually, or toggle 'Autopilot' to let the AI agent resolve delays automatically.";
        style = { top: "100px", left: "340px" };
        break;
      case 3:
        title = "Operations Analytics (KPIs)";
        desc = "Displays active fleet costs, carbon footprints, and SLA compliance. Hover over cards to see detailed operational calculations.";
        style = { top: "280px", left: "340px" };
        break;
      case 4:
        title = "Live Fleet Board";
        desc = "Monitors cargo trucks on route. Cards show PO invoice details, priority indicators, and real-time visual progress tracks.";
        style = { top: "180px", left: "40%" };
        break;
      case 5:
        title = "Copilot Audit Log";
        desc = "Watch the AI's thoughts as they compile. When severe disruptions happen, the agent queries SLA contracts and prompts you for decision approval.";
        style = { top: "120px", right: "400px" };
        break;
      default:
        return null;
    }

    return (
      <>
        <div className="tour-overlay" onClick={() => setTourStep(0)}></div>
        <div className="tour-tooltip-box" style={style}>
          <div className="tour-step-indicator">Tour Step {tourStep} of 5</div>
          <div className="tour-tooltip-title">{title}</div>
          <div className="tour-tooltip-desc">{desc}</div>
          <div className="tour-tooltip-footer">
            <button className="btn" style={{ padding: "6px 12px", fontSize: "0.75rem" }} onClick={() => setTourStep(0)}>
              Skip Tour
            </button>
            <div className="tour-btn-group">
              {tourStep > 1 && (
                <button 
                  className="btn" 
                  style={{ padding: "6px 12px", fontSize: "0.75rem" }} 
                  onClick={() => setTourStep(tourStep - 1)}
                >
                  Back
                </button>
              )}
              <button 
                className="btn btn-primary" 
                style={{ padding: "6px 12px", fontSize: "0.75rem" }}
                onClick={() => {
                  if (tourStep === 1) {
                    // Start simulation and move tour
                    initSimulation('standard_run');
                    setTourStep(2);
                  } else if (tourStep === 5) {
                    setTourStep(0);
                  } else {
                    setTourStep(tourStep + 1);
                  }
                }}
              >
                {tourStep === 1 ? "Launch & Next" : (tourStep === 5 ? "Finish" : "Next")}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  /* Render 1: Onboarding View */
  if (!simRun) {
    return (
      <div className="onboarding-container">
        {renderTourTooltip()}
        <div className="onboarding-card">
          <div className="onboarding-header">
            <div className="onboarding-logo">IFS</div>
            <h1 className="onboarding-title">IFS.ai Dispatch Copilot</h1>
            <p className="onboarding-subtitle">
              An AI-powered fleet control tower. When active delays occur (sensor-tracked truck breakdowns, severe weather warnings), the Copilot automatically queries contract SLAs, evaluates rates, and assists dispatchers in executing instant recovery actions.
            </p>
          </div>

          {apiError && (
            <div className="error-state-banner">
              <div className="error-state-title">
                <span>⚠️</span> Connection Error
              </div>
              <div className="error-state-desc">{apiError}</div>
              <button className="btn btn-primary" onClick={() => initSimulation()}>
                Retry Connection
              </button>
            </div>
          )}

          {/* System Process Flowchart */}
          <div className="flowchart-section">
            <h3 className="flowchart-title">Agentic Dispatch Lifecycle</h3>
            <div className="flowchart-steps">
              <div className="flowchart-step">
                <div className="step-num">01</div>
                <div className="step-content">
                  <h4>Discrete Clock</h4>
                  <p>Simulation steps hourly driving telemetry</p>
                </div>
              </div>
              <div className="flowchart-arrow">→</div>
              <div className="flowchart-step">
                <div className="step-num">02</div>
                <div className="step-content">
                  <h4>Disruption</h4>
                  <p>Weather alerts or vehicle breakdowns trigger</p>
                </div>
              </div>
              <div className="flowchart-arrow">→</div>
              <div className="flowchart-step">
                <div className="step-num">03</div>
                <div className="step-content">
                  <h4>RAG SLA Check</h4>
                  <p>Retrieves carrier constraints from DB</p>
                </div>
              </div>
              <div className="flowchart-arrow">→</div>
              <div className="flowchart-step">
                <div className="step-num">04</div>
                <div className="step-content">
                  <h4>ReAct Agent</h4>
                  <p>Claude analyzes options & rates</p>
                </div>
              </div>
              <div className="flowchart-arrow">→</div>
              <div className="flowchart-step">
                <div className="step-num">05</div>
                <div className="step-content">
                  <h4>HITL Override</h4>
                  <p>Human operator confirms / overrides</p>
                </div>
              </div>
            </div>
          </div>

          <div className="scenario-grid">
            <div 
              className={`scenario-card ${scenario === 'standard_run' ? 'active' : ''}`}
              onClick={() => setScenario('standard_run')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setScenario('standard_run')}
            >
              <div className="scenario-card-header">
                <span className="scenario-name">East Coast Corridor (Standard)</span>
                <div className="scenario-radio"></div>
              </div>
              <p className="scenario-desc">
                Monitors active shipping routes from Chicago to New York. seeds 3 shipments with standard regional deadlines. Triggers a minor weather delay on route.
              </p>
              <div className="scenario-meta">
                <div className="scenario-meta-item">
                  <span className="scenario-meta-icon">⏳</span> 24h Shift
                </div>
                <div className="scenario-meta-item">
                  <span className="scenario-meta-icon">📦</span> 3 Loads
                </div>
                <div className="scenario-meta-item">
                  <span className="scenario-meta-icon">⛈️</span> Weather
                </div>
              </div>
            </div>

            <div 
              className={`scenario-card ${scenario === 'supply_chain_chaos' ? 'active' : ''}`}
              onClick={() => setScenario('supply_chain_chaos')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setScenario('supply_chain_chaos')}
            >
              <div className="scenario-card-header">
                <span className="scenario-name">Severe Disruption Queue</span>
                <div className="scenario-radio"></div>
              </div>
              <p className="scenario-desc">
                National shipping monitor. Evaluates agent recovery during multiple simultaneous incidents: mid-route vehicle breakdowns, capacity cancellations, and rush orders.
              </p>
              <div className="scenario-meta">
                <div className="scenario-meta-item">
                  <span className="scenario-meta-icon">⏳</span> 48h Shift
                </div>
                <div className="scenario-meta-item">
                  <span className="scenario-meta-icon">📦</span> 4+ Loads
                </div>
                <div className="scenario-meta-item">
                  <span className="scenario-meta-icon">🔧</span> Breakdowns
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
            <button 
              className="btn" 
              style={{ flex: 1 }}
              onClick={() => setTourStep(1)}
            >
              Interactive Guided Tour
            </button>
            <button 
              className="btn btn-primary" 
              style={{ flex: 2 }}
              disabled={loading}
              onClick={() => initSimulation()}
            >
              {loading ? "Initializing Telemetry..." : "Start Dispatch Center"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* Render 2: Active Dashboard View */
  const simStatusLabel = showHITL ? "PAUSED FOR OPERATOR" : (isSimulating ? "COPILOT AUTOPILOT ACTIVE" : (simRun.status === 'COMPLETED' ? "SHIFT COMPLETED" : "LIVE MONITORING"));

  return (
    <div className="app-container">
      {renderTourTooltip()}

      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">IFS</div>
          <h1 className="brand-name">IFS.ai Control Tower</h1>
          <span className="brand-badge">Copilot Mode</span>
        </div>
        
        <div className="header-status-block">
          <div className={`header-sim-status ${showHITL ? 'hitl' : (isSimulating ? 'running' : (simRun.status === 'COMPLETED' ? 'completed' : ''))}`}>
            <div className="header-status-dot"></div>
            <span>FLEET CONTROL: <strong>{simStatusLabel}</strong></span>
          </div>
          <button 
            className="btn" 
            style={{ padding: '6px 12px', background: 'transparent', borderColor: 'var(--border-color)', fontSize: '0.75rem' }}
            onClick={handleReset}
          >
            Reset Shifts
          </button>
        </div>
      </header>

      {/* Mobile navigation tab buttons */}
      <div className="mobile-tabs">
        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          📊 KPIs & Contracts
        </button>
        <button className={`tab-btn ${activeTab === 'shipments' ? 'active' : ''}`} onClick={() => setActiveTab('shipments')}>
          🚚 Active Fleet
        </button>
        <button className={`tab-btn ${activeTab === 'agent' ? 'active' : ''}`} onClick={() => setActiveTab('agent')}>
          🧠 Copilot Log
        </button>
      </div>

      {/* Main Grid */}
      <main className="dashboard-grid">
        
        {/* Sidebar Controls & KPIs */}
        <section className={`sidebar ${activeTab === 'dashboard' ? 'tab-active' : ''} ${tourStep === 2 || tourStep === 3 ? 'tour-active-highlight' : ''}`}>
          
          <div className="sidebar-section">
            <div className="panel-title-row" style={{ position: 'relative' }}>
              <h2 className="panel-title">Control tower</h2>
              <button 
                className="info-help-btn"
                onMouseEnter={() => setHoveredHelpPanel("control")}
                onMouseLeave={() => setHoveredHelpPanel(null)}
                aria-label="Help info"
              >
                ?
              </button>
              {hoveredHelpPanel === "control" && (
                <div className="info-tooltip-box">
                  <strong>Control Tower SOP:</strong> Manual stepping advances the clock by 1 shift hour. Autopilot lets the AI Copilot resolve delay disruptions automatically in real-time.
                </div>
              )}
            </div>

            <div className="control-group">
              <button 
                className="btn btn-primary" 
                onClick={() => handleStep(simRun.id)}
                disabled={isSimulating || simRun.status === 'COMPLETED' || showHITL || loading}
              >
                Step 1 Shift Hour
              </button>
              <button 
                className={`btn ${isSimulating ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => setIsSimulating(!isSimulating)}
                disabled={simRun.status === 'COMPLETED' || showHITL || loading}
              >
                {isSimulating ? "Deactivate Autopilot" : "Activate Autopilot"}
              </button>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="panel-title-row" style={{ position: 'relative' }}>
              <h2 className="panel-title">Copilot analytics</h2>
              <button 
                className="info-help-btn"
                onMouseEnter={() => setHoveredHelpPanel("kpis")}
                onMouseLeave={() => setHoveredHelpPanel(null)}
                aria-label="Help info"
              >
                ?
              </button>
              {hoveredHelpPanel === "kpis" && (
                <div className="info-tooltip-box">
                  <strong>KPI Audit:</strong> Live statistics summarizing freight costs, SLA delay parameters, and fleet carbon credits. Hover over cards for details.
                </div>
              )}
            </div>

            <div className="kpi-container">
              <div className="kpi-card">
                <div className="kpi-card-main">
                  <div>
                    <div className="kpi-header-row">
                      <span className="kpi-label">Active Fleet Cost</span>
                      <span className="kpi-icon">💰</span>
                    </div>
                    <span className="kpi-value">
                      ${simRun.total_cost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                  </div>
                  <div className="kpi-visual">
                    <svg width="70" height="28" className="sparkline-svg">
                      {costHistory.length > 1 ? (
                        (() => {
                          const maxCost = Math.max(...costHistory.map(h => h.cost));
                          const minCost = Math.min(...costHistory.map(h => h.cost));
                          const costRange = maxCost - minCost || 1;
                          const totalTicks = simRun.total_ticks || 24;
                          
                          const points = costHistory.map(h => {
                            const x = (h.tick / totalTicks) * 70;
                            const y = 28 - ((h.cost - minCost) / costRange) * 24 - 2;
                            return `${x},${y}`;
                          }).join(" ");
                          
                          return (
                            <>
                              <polyline
                                fill="none"
                                stroke="var(--accent-blue)"
                                strokeWidth="2"
                                points={points}
                              />
                              <polygon
                                fill="rgba(0, 180, 216, 0.15)"
                                points={`0,28 ${points} 70,28`}
                              />
                            </>
                          );
                        })()
                      ) : (
                        <line x1="0" y1="14" x2="70" y2="14" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" strokeDasharray="3 3" />
                      )}
                    </svg>
                  </div>
                </div>
                <div className="kpi-hover-popover">
                  <div className="kpi-popover-row">Rate Calculations: <strong>Miles × Rate</strong></div>
                  <div className="kpi-popover-row">Includes spot penalties for unassigned routes.</div>
                </div>
              </div>
              
              <div className="kpi-card sla">
                <div className="kpi-card-main">
                  <div>
                    <div className="kpi-header-row">
                      <span className="kpi-label">SLA Compliance</span>
                      <span className="kpi-icon">🛡️</span>
                    </div>
                    <span className="kpi-value">
                      {(simRun.sla_compliance * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="kpi-visual">
                    <svg width="32" height="32" viewBox="0 0 36 36" className="gauge-svg">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15" fill="none" 
                              stroke="url(#sla-gradient)" 
                              strokeWidth="3.5" 
                              strokeDasharray="94.2"
                              strokeDashoffset={94.2 - (simRun.sla_compliance * 94.2)}
                              strokeLinecap="round"
                              transform="rotate(-90 18 18)"
                              className="gauge-progress" />
                      <defs>
                        <linearGradient id="sla-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="var(--accent-blue)" />
                          <stop offset="100%" stopColor="var(--accent-cyan)" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                </div>
                <div className="kpi-hover-popover">
                  <div className="kpi-popover-row">On-time loads: <strong>Guaranteed Deadline Met</strong></div>
                  <div className="kpi-popover-row">Target threshold: 90% contract rating.</div>
                </div>
              </div>
              
              <div className="kpi-card emissions">
                <div className="kpi-card-main">
                  <div>
                    <div className="kpi-header-row">
                      <span className="kpi-label">Carbon Credits (CO2)</span>
                      <span className="kpi-icon">🌿</span>
                    </div>
                    <span className="kpi-value">
                      {simRun.emissions.toFixed(1)} kg
                    </span>
                  </div>
                  <div className="kpi-visual">
                    <div className="eco-bar-wrapper">
                      <div className="eco-bar-fill" style={{ width: `${Math.max(10, Math.min(100, (simRun.emissions / 1200) * 100))}%` }}></div>
                    </div>
                  </div>
                </div>
                <div className="kpi-hover-popover">
                  <div className="kpi-popover-row">Eco calculation: <strong>Tons × Mile × Efficiency</strong></div>
                  <div className="kpi-popover-row">EcoFreight Solutions offsets 95% emissions.</div>
                </div>
              </div>
            </div>
          </div>

          {/* Carrier Contracts & Manual RAG search */}
          <div className="sidebar-section">
            <div className="panel-title-row" style={{ position: 'relative' }}>
              <h2 className="panel-title">Contract sla search</h2>
              <button 
                className="info-help-btn"
                onMouseEnter={() => setHoveredHelpPanel("rag")}
                onMouseLeave={() => setHoveredHelpPanel(null)}
                aria-label="Help info"
              >
                ?
              </button>
              {hoveredHelpPanel === "rag" && (
                <div className="info-tooltip-box">
                  <strong>Contract Search Console:</strong> Directly queries carrier SLAs stored in the local vector DB, matching synonyms for mechanical failure, storms, or late fees.
                </div>
              )}
            </div>

            <div className="rag-search-section">
              <div className="rag-input-wrapper">
                <input 
                  type="text" 
                  className="rag-search-input"
                  placeholder="Query SLA terms (e.g. breakdown, weather)..."
                  value={ragQuery}
                  onChange={(e) => setRagQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && executeContractSearch()}
                />
                <button 
                  className="rag-search-btn" 
                  disabled={ragLoading}
                  onClick={executeContractSearch}
                >
                  {ragLoading ? "..." : "Search"}
                </button>
              </div>

              {ragResults.length > 0 ? (
                <div className="rag-results-container">
                  {ragResults.map(r => (
                    <div key={r.id} className="rag-result-card">
                      <div className="rag-result-header">
                        <span className="rag-result-title">{r.title}</span>
                        <span className="rag-result-score">{(r.score * 100).toFixed(0)}% Match</span>
                      </div>
                      <p className="rag-result-content">{r.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                  RAG Hybrid Search parses documents and ranks by relevance.
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Center Panel (Active Fleet Board) */}
        <section className={`center-panel ${activeTab === 'shipments' ? 'tab-active' : ''} ${tourStep === 4 ? 'tour-active-highlight' : ''}`}>
          
          <div className="section-header">
            <h2>Active Telemetry Board</h2>
            <div className="simulation-time-card">
              <span className="time-title">SHIFT RUNTIME</span>
              <div className="time-progress-section">
                <div className="time-bar-wrapper">
                  <div 
                    className="time-bar-fill"
                    style={{ width: `${(simRun.current_tick / simRun.total_ticks) * 100}%` }}
                  ></div>
                </div>
                <div className="tick-display">
                  Shift Hour: {simRun.current_tick}:00 EST
                </div>
              </div>
            </div>
          </div>

          {apiError && (
            <div className="error-state-banner">
              <div className="error-state-title">
                <span>⚠️</span> Telemetry Error
              </div>
              <div className="error-state-desc">{apiError}</div>
              <button className="btn" style={{ background: 'transparent', borderColor: 'var(--accent-red)' }} onClick={() => setApiError(null)}>
                Dismiss
              </button>
            </div>
          )}

          {/* Interactive Route Telemetry Map */}
          {shipments.length > 0 && (
            <div className="telemetry-map-container">
              <div className="map-header">
                <h3>Live Network Telemetry</h3>
                <span className="map-legend">
                  <span className="legend-item"><span className="legend-dot normal"></span> Active</span>
                  <span className="legend-item"><span className="legend-dot delay"></span> Delay</span>
                  <span className="legend-item"><span className="legend-dot breakdown"></span> Breakdown</span>
                  <span className="legend-item"><span className="legend-dot delivered"></span> Delivered</span>
                </span>
              </div>
              <div className="svg-map-wrapper">
                <svg viewBox="0 0 800 350" width="100%" height="100%">
                  <defs>
                    <pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="800" height="350" fill="url(#map-grid)" rx="8" />
                  
                  {/* Background Connection Mesh (stylized grid) */}
                  <path d="M 80 210 L 160 220 M 160 220 L 300 130 M 200 110 L 300 130 M 80 40 L 200 110 M 300 130 L 530 100 M 410 250 L 300 130 M 530 100 L 710 90 M 530 100 L 590 90 M 590 90 L 710 90 M 570 220 L 650 310 M 530 100 L 570 220 M 410 250 L 570 220" 
                        stroke="rgba(255,255,255,0.05)" strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
                  
                  {/* Active Shipments Route Paths */}
                  {shipments.map(s => {
                    const originHub = CITY_COORDINATES[s.origin];
                    const destHub = CITY_COORDINATES[s.destination];
                    if (!originHub || !destHub) return null;
                    
                    const isActiveDelay = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'WEATHER_DELAY');
                    const isActiveBreakdown = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'TRUCK_BREAKDOWN');
                    
                    let strokeColor = "var(--accent-blue)";
                    let pathClass = "route-path";
                    if (s.status === 'DELIVERED') {
                      strokeColor = "var(--accent-neon-green)";
                      pathClass += " delivered";
                    } else if (isActiveBreakdown) {
                      strokeColor = "var(--accent-red)";
                      pathClass += " breakdown";
                    } else if (isActiveDelay || s.status === 'DELAYED') {
                      strokeColor = "var(--accent-yellow)";
                      pathClass += " delayed";
                    } else if (s.status === 'IN_TRANSIT') {
                      pathClass += " active";
                    }
                    
                    const mx = (originHub.x + destHub.x) / 2;
                    const my = (originHub.y + destHub.y) / 2 - 20;
                    const pathD = `M ${originHub.x} ${originHub.y} Q ${mx} ${my} ${destHub.x} ${destHub.y}`;
                    
                    return (
                      <g key={`route-${s.shipment_id}`}>
                        <path 
                          d={pathD} 
                          className={pathClass}
                          stroke={strokeColor} 
                          fill="none" 
                          strokeWidth="2"
                          opacity={s.status === 'PENDING' ? 0.2 : 0.8}
                        />
                      </g>
                    );
                  })}
                  
                  {/* Moving Trucks / Markers */}
                  {shipments.map(s => {
                    if (s.status === 'PENDING') return null;
                    const originHub = CITY_COORDINATES[s.origin];
                    const destHub = CITY_COORDINATES[s.destination];
                    if (!originHub || !destHub) return null;
                    
                    const progress = s.current_position_progress;
                    const t = progress;
                    const mx = (originHub.x + destHub.x) / 2;
                    const my = (originHub.y + destHub.y) / 2 - 20;
                    
                    const tx = (1 - t) * (1 - t) * originHub.x + 2 * (1 - t) * t * mx + t * t * destHub.x;
                    const ty = (1 - t) * (1 - t) * originHub.y + 2 * (1 - t) * t * my + t * t * destHub.y;
                    
                    const isActiveDelay = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'WEATHER_DELAY');
                    const isActiveBreakdown = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'TRUCK_BREAKDOWN');
                    
                    let glowColor = "var(--accent-cyan)";
                    let pulseClass = "truck-pulse";
                    if (s.status === 'DELIVERED') {
                      glowColor = "var(--accent-neon-green)";
                      pulseClass = "truck-pulse delivered";
                    } else if (isActiveBreakdown) {
                      glowColor = "var(--accent-red)";
                      pulseClass = "truck-pulse breakdown";
                    } else if (isActiveDelay || s.status === 'DELAYED') {
                      glowColor = "var(--accent-yellow)";
                      pulseClass = "truck-pulse delayed";
                    }
                    
                    return (
                      <g key={`truck-${s.shipment_id}`} transform={`translate(${tx}, ${ty})`}>
                        <circle r="10" fill={glowColor} className={pulseClass} opacity="0.35" />
                        <circle r="4" fill="#fff" stroke={glowColor} strokeWidth="1.5" />
                        <text y="-12" textAnchor="middle" className="map-truck-label" fill="#fff">
                          {s.shipment_id}
                        </text>
                      </g>
                    );
                  })}
                  
                  {/* City Hub Nodes */}
                  {Object.entries(CITY_COORDINATES).map(([name, coords]) => {
                    const isHubActive = shipments.some(s => 
                      s.status !== 'DELIVERED' && 
                      (s.origin === name || s.destination === name)
                    );
                    
                    return (
                      <g key={`city-${name}`} transform={`translate(${coords.x}, ${coords.y})`}>
                        <circle r="4" fill={isHubActive ? "var(--accent-cyan)" : "rgba(255,255,255,0.25)"} />
                        <circle r="1" fill="#fff" />
                        <text y="12" textAnchor="middle" className="map-city-label" fill={isHubActive ? "#fff" : "var(--text-muted)"}>
                          {coords.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* Shipment Cards */}
          <div className="shipment-list">
            {shipments.length === 0 ? (
              <div className="empty-state-view">
                <div className="empty-state-icon">📦</div>
                <div className="empty-state-text">Select a corridor and initialize sandbox to seed active fleet telemetry.</div>
              </div>
            ) : (
              shipments.map(s => {
                const isActiveDelay = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'WEATHER_DELAY');
                const isActiveBreakdown = disruptions.some(d => d.target_shipment_id === s.shipment_id && !d.resolved && d.event_type === 'TRUCK_BREAKDOWN');
                let cardClass = "shipment-card";
                if (isActiveBreakdown) cardClass += " breakdown";
                else if (isActiveDelay) cardClass += " delayed";

                // Augment real-world display details
                const meta = getShipmentMeta(s.shipment_id);

                return (
                  <div key={s.shipment_id} className={cardClass}>
                    <div className="shipment-top-row">
                      <div className="shipment-meta-left">
                        <div className="shipment-id-badge">{s.shipment_id}</div>
                        <div className="route-display">
                          <strong>{meta.customer}</strong>
                          <span className="route-connector">|</span>
                          <span>{s.origin} → {s.destination}</span>
                        </div>
                      </div>
                      <span className={`status-badge ${s.status.toLowerCase()}`}>
                        <span>{getStatusIcon(s.status)}</span>
                        <span>{s.status.replace('_', ' ')}</span>
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: "10px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      <span><strong>Cargo:</strong> {meta.cargo}</span>
                      <span>•</span>
                      <span><strong>Value:</strong> {meta.value}</span>
                      <span>•</span>
                      <span style={{ color: meta.priority === 'Critical SLA' ? 'var(--accent-neon-red)' : 'var(--text-muted)' }}>
                        <strong>{meta.priority}</strong>
                      </span>
                    </div>

                    {/* Visual tracking timeline */}
                    <div className="shipment-visual-track">
                      <div className="progress-track-bar">
                        <div 
                          className={`progress-track-fill ${s.status === 'DELAYED' ? 'delayed' : ''}`}
                          style={{ width: `${s.current_position_progress * 100}%` }}
                        ></div>
                        <div 
                          className="progress-dot-marker"
                          style={{ left: `${s.current_position_progress * 100}%` }}
                        ></div>
                      </div>
                      
                      <div className="timeline-meta-row">
                        <span>Progress: {(s.current_position_progress * 100).toFixed(0)}%</span>
                        <div className="timeline-meta-right">
                          <span>ETA: Hour {s.eta_ticks}</span>
                          <span className="timeline-deadline">Deadline: Hour {s.deadline_ticks}</span>
                        </div>
                      </div>
                    </div>

                    {/* Active Disruption Warnings in Card */}
                    {disruptions.filter(d => d.target_shipment_id === s.shipment_id && !d.resolved).map(d => (
                      <div key={d.id} className="card-disruption-alert">
                        <div className="card-disruption-icon">{getDisruptionIcon(d.event_type)}</div>
                        <div className="card-disruption-text">
                          <strong>Incident:</strong> {d.description}
                        </div>
                      </div>
                    ))}

                    {/* Detail Grid */}
                    <div className="shipment-details-grid">
                      <div className="detail-item">
                        <span className="detail-label">Carrier</span>
                        <span className="detail-val highlight">{s.carrier_name || "Unassigned"}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Weight</span>
                        <span className="detail-val">{(s.weight / 2000).toFixed(1)} tons</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Distance</span>
                        <span className="detail-val">{s.route_mileage} miles</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Est. Cost</span>
                        <span className="detail-val">${s.cost.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Sidebar (Agent Monologue Logs) */}
        <section 
          className={`agent-panel ${activeTab === 'agent' ? 'tab-active' : ''} ${drawerOpen ? 'drawer-open' : ''} ${isSimulating ? 'thinking' : 'active'} ${tourStep === 5 ? 'tour-active-highlight' : ''}`}
        >
          <div className="agent-header">
            <div className="agent-title-block">
              <div className="agent-status-indicator"></div>
              <h2>Copilot Reasoning Console</h2>
            </div>
            {logs.length > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{logs.length} Trace Events</span>}
          </div>

          <div 
            className="agent-logs-container"
            ref={logsContainerRef}
            onScroll={handleLogsScroll}
          >
            {logs.length === 0 ? (
              <div className="empty-state-view" style={{ border: 'none', background: 'transparent' }}>
                <div className="empty-state-icon">🧠</div>
                <div className="empty-state-text">Copilot reasoning traces will display once contract queries start.</div>
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="log-entry">
                  <div className="log-meta-bar">
                    <span>HOUR {log.tick}:00 EST</span>
                    <span>COPILOT RAG AUDIT</span>
                  </div>
                  <div className="log-thought-block">
                    <strong>Reasoning:</strong> {log.thought}
                  </div>
                  {log.action && log.action !== 'None' && (
                    <div className="log-action-container">
                      <div className="log-action-header">Executed Tool: {log.action}()</div>
                      <div className="log-action-payload">Args: {log.action_input}</div>
                    </div>
                  )}
                  {log.observation && (
                    <div className="log-observation-block">
                      <strong>Observation:</strong> {log.observation}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Jump to latest floating button */}
          {showJumpToLatest && (
            <button className="jump-to-latest-btn" onClick={scrollToBottom}>
              <span>↓</span> Jump to latest
            </button>
          )}
        </section>
      </main>

      {/* Floating Agent Drawer Toggle for Mobile/Tablet */}
      <button 
        className="agent-drawer-toggle" 
        onClick={() => setDrawerOpen(!drawerOpen)}
        aria-label="Toggle Agent Panel"
      >
        <span>🧠</span>
        <div className={`agent-status-indicator ${isSimulating ? 'thinking' : ''}`} style={{ background: isSimulating ? 'var(--accent-yellow)' : 'var(--accent-neon-green)' }}></div>
      </button>
      
      {/* Drawer Overlay */}
      <div 
        className={`drawer-overlay ${drawerOpen ? 'active' : ''}`}
        onClick={() => setDrawerOpen(false)}
      ></div>

      {/* Human-in-the-Loop Comparison Modal */}
      {showHITL && hitlData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-header-icon">!</div>
              <div className="modal-header-text">
                <h3>Operator Intervention Required</h3>
                <span>Autopilot paused. Select carrier reassignment to recover from route breakdown.</span>
              </div>
            </div>
            
            <div className="modal-body">
              <div className="modal-info-bar">
                <div className="modal-meta-box">
                  <span className="detail-label">Affected Load</span>
                  <span className="modal-meta-val">{hitlData.shipment_id} ({getShipmentMeta(hitlData.shipment_id).customer})</span>
                </div>
                <div className="modal-meta-box">
                  <span className="detail-label">Disruption Incident</span>
                  <span className="modal-meta-val warn">{hitlData.reason}</span>
                </div>
              </div>

              <div className="carrier-comparison-title">Select Carrier Contract to Re-route</div>
              
              <div className="carrier-comparison-grid">
                {carriers.map(c => {
                  const isAgentChoice = c.carrier_id === hitlData.proposed_carrier_id;
                  const isSelected = c.carrier_id === selectedCarrierId;
                  const affectedShipment = shipments.find(s => s.shipment_id === hitlData.shipment_id);
                  const estCost = affectedShipment ? affectedShipment.route_mileage * c.base_rate_per_mile : 0;

                  return (
                    <div 
                      key={c.carrier_id} 
                      className={`carrier-comparison-card ${isAgentChoice ? 'recommended' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedCarrierId(c.carrier_id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setSelectedCarrierId(c.carrier_id)}
                    >
                      <div className="comparison-card-header">
                        <span className="comparison-carrier-name">{c.name}</span>
                        <div className="carrier-selection-indicator"></div>
                      </div>

                      <div className="comparison-metrics-block">
                        <div className="comparison-row">
                          <span className="comparison-label">Base Rate</span>
                          <span className="comparison-val">${c.base_rate_per_mile}/mi</span>
                        </div>
                        <div className="comparison-row">
                          <span className="comparison-label">Est. Cost</span>
                          <span className="comparison-val blue">${estCost.toFixed(2)}</span>
                        </div>
                        <div className="comparison-row">
                          <span className="comparison-label">SLA SLA Trust</span>
                          <span className="comparison-val green">{c.reliability * 100}%</span>
                        </div>
                        <div className="comparison-row">
                          <span className="comparison-label">Eco efficiency</span>
                          <span className="comparison-val green">{c.sustainability * 100}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn" 
                style={{ background: 'transparent', borderColor: 'var(--border-color)' }}
                onClick={() => {
                  setSelectedCarrierId(hitlData.proposed_carrier_id);
                  submitHITL('APPROVE');
                }}
              >
                Approve Agent Choice
              </button>
              <button 
                className="btn btn-primary"
                disabled={selectedCarrierId === hitlData.proposed_carrier_id}
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
