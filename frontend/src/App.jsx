import React, { useState, useEffect, useRef } from 'react';
import Vapi from "@vapi-ai/web";
import './style.css';

// LIVE PUBLIC KEY FROM VAPI DASHBOARD
const VAPI_PUBLIC_KEY = "4fff1917-d451-4051-9c05-cece760a6a5b";
const vapi = new Vapi(VAPI_PUBLIC_KEY);

const App = () => {
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [callStatus, setCallStatus] = useState('inactive'); // 'inactive', 'loading', 'active'
  const ws = useRef(null);

  // Auto-select first job
  useEffect(() => {
    if (jobs.length > 0 && !selectedJobId) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs]);

  useEffect(() => {
    fetchJobs();
    connectWebSocket();

    vapi.on("call-start", () => setCallStatus('active'));
    vapi.on("call-end", () => setCallStatus('inactive'));
    vapi.on("error", (err) => {
      console.error("Vapi Error:", err);
      setCallStatus('inactive');
    });

    return () => {
      ws.current?.close();
      vapi.stop();
    };
  }, []);

  const handleTalkToAI = async (job) => {
    if (callStatus === 'active') {
      vapi.stop();
      return;
    }

    setCallStatus('loading');
    const assistantId = "456654db-f612-457d-81e8-3d04021d0d5b"; // From your .env
    
    try {
      await vapi.start(assistantId, {
        variableValues: {
          candidate_name: job.payload?.name || "Candidate",
          tech_context: job.evaluation?.summary || "No specific context found yet."
        }
      });
    } catch (err) {
      console.error("Vapi Start Failed:", err);
      setCallStatus('inactive');
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch('http://localhost:8000/jobs');
      const data = await res.json();
      setJobs(data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (err) {
      console.error("Failed to fetch jobs", err);
    }
  };

  const connectWebSocket = () => {
    ws.current = new WebSocket('ws://localhost:8000/ws');
    
    ws.current.onopen = () => setWsStatus('connected');
    ws.current.onclose = () => {
      setWsStatus('disconnected');
      setTimeout(connectWebSocket, 3000);
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("WS Event:", data);
      
      if (data.type === 'job_update' || data.type === 'status_update' || data.type === 'job_complete') {
        setJobs(prev => {
          const jobId = data.job_id || data.id;
          const index = prev.findIndex(j => j.id === jobId);
          
          if (index === -1) {
            // New job found via WS
            return [{ ...data, id: jobId }, ...prev];
          }
          
          const newJobs = [...prev];
          // SMART MERGE: Keep existing data, only update new fields
          const updatedJob = { 
            ...newJobs[index], 
            ...data, 
            status: data.status || newJobs[index].status 
          };
          newJobs[index] = updatedJob;

          // If this is the currently viewed job, update the view state too
          if (jobId === selectedJobId) {
            setSelectedJob(updatedJob);
          }
          
          return newJobs;
        });
      }

      if (data.type === 'agent_step') {
        setJobs(prev => {
          return prev.map(job => {
            if (job.id === data.job_id) {
              const steps = job.agent_steps || [];
              if (!steps.find(s => s.id === data.id)) {
                 return { ...job, agent_steps: [...steps, data] };
              }
            }
            return job;
          });
        });
      }
      if (data.type === 'agent_thought') {
        setJobs(prev => {
          return prev.map(job => {
            if (job.id === data.job_id) {
              const thoughts = job.thoughts || [];
              if (!thoughts.find(t => t.timestamp === data.timestamp)) {
                 return { ...job, thoughts: [...thoughts, data] };
              }
            }
            return job;
          });
        });
      }
    };
  };

  const selectedJob = jobs.find(j => j.id === selectedJobId);
  const thoughtsRef = useRef(null);

  useEffect(() => {
    if (thoughtsRef.current) {
      thoughtsRef.current.scrollTop = thoughtsRef.current.scrollHeight;
    }
  }, [selectedJob?.thoughts]);

  return (
    <div className="app-container">
      {/* Sidebar Container */}
      <div className="sidebar-container">
        <div className="glass-card" style={{ height: '100%', overflowY: 'auto' }}>
          <div style={{ padding: '24px' }}>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-1px', marginBottom: '4px' }}>
              GENIUS<span style={{ color: 'var(--primary)' }}>AI</span>
            </h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>
              Pipeline Control
            </p>
          </div>

          <div style={{ padding: '0 12px' }}>
            {jobs.map(job => (
              <div 
                key={job.id} 
                className={`sidebar-item ${selectedJobId === job.id ? 'active' : ''}`}
                onClick={() => {
                  console.log("Senior Engineer Debug: Selecting Job", job.id);
                  setSelectedJobId(job.id);
                }}
              >
                <div className="sidebar-info">
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                    {job.payload?.name || 'Loading...'}
                  </span>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                    {job.role_applied || 'Unknown Role'}
                  </p>
                </div>
                
                <span className={`status-indicator status-${job.status?.toLowerCase()}`}></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        {!selectedJob ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
            Select a candidate to view evaluation
          </div>
        ) : (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
              <div>
                <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '8px' }}>{selectedJob.payload?.name}</h2>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{selectedJob.role_applied}</span>
                  <span style={{ color: 'var(--text-dim)' }}>•</span>
                  <span style={{ color: 'var(--text-dim)' }}>{selectedJob.email}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                {(selectedJob.decision === 'STRONG_YES' || selectedJob.decision === 'SOFT_YES') && (
                  <button 
                    onClick={() => handleTalkToAI(selectedJob)}
                    className={`btn-voice ${callStatus === 'active' ? 'active' : ''}`}
                    disabled={callStatus === 'loading'}
                  >
                    {callStatus === 'loading' ? 'Connecting...' : 
                     callStatus === 'active' ? '⏹ Stop Call' : '🎙 Talk to AI'}
                  </button>
                )}

                <div className="glass-card" style={{ padding: '12px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px' }}>CONFIDENCE</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)' }}>
                    {selectedJob.evaluation?.confidence_score || 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* Agent Monologue */}
            <div className="glass-card" style={{ padding: '20px', marginBottom: '32px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Live Agent Monologue
              </h3>
              <div 
                ref={thoughtsRef}
                style={{ 
                  height: '120px', 
                  overflowY: 'auto', 
                  fontFamily: 'JetBrains Mono, monospace', 
                  fontSize: '0.8rem',
                  lineHeight: 1.5,
                  padding: '12px',
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: '12px'
                }}
              >
                {selectedJob.thoughts?.length > 0 ? (
                  selectedJob.thoughts.map((t, i) => (
                    <div key={i} style={{ marginBottom: '6px', color: 'var(--text-main)' }}>
                      <span style={{ color: 'var(--text-dim)' }}>[{new Date(t.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>{' '}
                      <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{t.agent.toUpperCase()}</span>: {t.thought}
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Waiting for agent reasoning...</div>
                )}
              </div>
            </div>

            {/* Scorecard Grid */}
            {selectedJob.evaluation?.scorecard && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '40px' }}>
                {Object.entries(selectedJob.evaluation.scorecard).map(([key, value]) => (
                  <div key={key} className="glass-card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: '0.9rem' }}>
                        {key.replace('_', ' ')}
                      </span>
                      <span style={{ fontWeight: 800, color: 'var(--primary)' }}>{value}/10</span>
                    </div>
                    <div className="score-bar-bg">
                      <div className="score-bar-fill" style={{ width: `${value * 10}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Evaluation Tabs */}
            <div className="glass-card" style={{ padding: '32px', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--primary)' }}>#</span> Executive Summary
              </h3>
              <p style={{ lineHeight: 1.6, color: 'var(--text-main)', fontSize: '1.05rem', marginBottom: '32px' }}>
                {selectedJob.evaluation?.summary}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                <div>
                  <h4 style={{ color: 'var(--success)', fontWeight: 700, marginBottom: '12px', fontSize: '0.9rem' }}>TOP STRENGTHS</h4>
                  <ul style={{ listStyle: 'none' }}>
                    {selectedJob.evaluation?.strengths?.map((s, i) => (
                      <li key={i} style={{ marginBottom: '8px', fontSize: '0.95rem', display: 'flex', gap: '10px' }}>
                        <span style={{ color: 'var(--success)' }}>✓</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 style={{ color: 'var(--error)', fontWeight: 700, marginBottom: '12px', fontSize: '0.9rem' }}>CONCERNS</h4>
                  <ul style={{ listStyle: 'none' }}>
                    {selectedJob.evaluation?.concerns?.map((c, i) => (
                      <li key={i} style={{ marginBottom: '8px', fontSize: '0.95rem', display: 'flex', gap: '10px' }}>
                        <span style={{ color: 'var(--error)' }}>!</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Live Agent Timeline */}
            <div style={{ marginBottom: '64px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '16px', letterSpacing: '2px' }}>
                AGENT TIMELINE
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {selectedJob.agent_steps?.map((step, i) => (
                  <div key={i} className="glass-card" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: 'var(--primary)', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                          {step.agent}
                        </span>
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{step.step}</span>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {step.status === 'running' ? 'Processing...' : 'Complete'}
                      </span>
                    </div>
                  </div>
                ))}
                {selectedJob.status === 'RESEARCHING' && (
                  <div className="glass-card status-active" style={{ padding: '16px', background: 'rgba(99,102,241,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="status-indicator status-active"></div>
                      <span style={{ fontWeight: 600, color: 'var(--primary)' }}>Agent is researching candidate...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connectivity Toast */}
      <div style={{ 
        position: 'fixed', 
        bottom: '24px', 
        right: '24px', 
        padding: '8px 16px', 
        borderRadius: '100px',
        fontSize: '0.75rem',
        fontWeight: 700,
        backgroundColor: wsStatus === 'connected' ? 'var(--success-glow)' : 'rgba(239, 68, 68, 0.1)',
        color: wsStatus === 'connected' ? 'var(--success)' : 'var(--error)',
        border: `1px solid ${wsStatus === 'connected' ? 'var(--success)' : 'var(--error)'}`,
        backdropFilter: 'blur(10px)'
      }}>
        WS: {wsStatus.toUpperCase()}
      </div>
    </div>
  );
};

export default App;
