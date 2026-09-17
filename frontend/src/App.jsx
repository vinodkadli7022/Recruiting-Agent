import React, { useState, useEffect, useRef } from 'react';
import Vapi from "@vapi-ai/web";
import './style.css';

// DYNAMIC CLOUD OR LOCAL URL RESOLUTION
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE = import.meta.env.VITE_WS_URL || (
  window.location.protocol === 'https:' 
    ? `wss://${window.location.host}/ws` 
    : 'ws://localhost:8000/ws'
);

// LIVE PUBLIC KEY FROM VAPI DASHBOARD
const VAPI_PUBLIC_KEY = "4fff1917-d451-4051-9c05-cece760a6a5b";
const vapi = new Vapi(VAPI_PUBLIC_KEY);

const App = () => {
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [callStatus, setCallStatus] = useState('inactive');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const ws = useRef(null);

  // Modal & Application State
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState('resume'); // 'resume' | 'manual'
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeRole, setResumeRole] = useState('Senior Backend Engineer');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalFeedback, setModalFeedback] = useState(null);

  // Manual Form State
  const [manualData, setManualData] = useState({
    name: '',
    email: '',
    github_handle: '',
    role_applied: 'Senior Backend Engineer',
    phone_number: '+917022683634'
  });

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
    const assistantId = "456654db-f612-457d-81e8-3d04021d0d5b";
    
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

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      fetchJobs();
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 10 })
      });
      const data = await res.json();
      setJobs(data);
      if (data.length > 0) setSelectedJobId(data[0].id);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setIsSearching(false);
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      const data = await res.json();
      setJobs(data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (err) {
      console.error("Failed to fetch jobs", err);
    }
  };

  const connectWebSocket = () => {
    ws.current = new WebSocket(WS_BASE);
    
    ws.current.onopen = () => setWsStatus('connected');
    ws.current.onclose = () => {
      setWsStatus('disconnected');
      setTimeout(connectWebSocket, 3000);
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("WS Event:", data);
      
      if (data.type === 'job_received') {
        fetchJobs();
      }

      if (data.type === 'job_update' || data.type === 'status_update' || data.type === 'job_complete') {
        setJobs(prev => {
          const jobId = data.job_id || data.id;
          const index = prev.findIndex(j => j.id === jobId);
          
          if (index === -1) {
            return [{ ...data, id: jobId }, ...prev];
          }
          
          const newJobs = [...prev];
          const updatedJob = { 
            ...newJobs[index], 
            ...data, 
            status: data.status || newJobs[index].status 
          };
          newJobs[index] = updatedJob;

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

  // Resume Upload Handler
  const handleResumeSubmit = async (e) => {
    e.preventDefault();
    if (!resumeFile) {
      setModalFeedback({ type: 'error', text: 'Please select a PDF resume file.' });
      return;
    }

    setIsSubmitting(true);
    setModalFeedback({ type: 'info', text: 'Extracting resume details via AI & launching agents...' });

    const formData = new FormData();
    formData.append('file', resumeFile);
    formData.append('role_applied', resumeRole);

    try {
      const res = await fetch(`${API_BASE}/webhook/resume`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setModalFeedback({
          type: 'success',
          text: `Extracted: ${data.extracted?.name} (@${data.extracted?.github_handle || 'no-gh'}). Dispatched to Research Agent!`
        });
        setTimeout(() => {
          setShowModal(false);
          setModalFeedback(null);
          setResumeFile(null);
          fetchJobs();
        }, 2200);
      } else {
        setModalFeedback({ type: 'error', text: data.detail || 'Failed to submit resume.' });
      }
    } catch (err) {
      setModalFeedback({ type: 'error', text: `Network error: ${err.message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Manual Input Submit Handler
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualData.name || !manualData.email) {
      setModalFeedback({ type: 'error', text: 'Name and Email are required.' });
      return;
    }

    setIsSubmitting(true);
    setModalFeedback({ type: 'info', text: 'Dispatching candidate to autonomous pipeline...' });

    try {
      const res = await fetch(`${API_BASE}/webhook/applicant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualData),
      });
      const data = await res.json();

      if (res.ok) {
        setModalFeedback({
          type: 'success',
          text: `Candidate ${manualData.name} dispatched to Autonomous Agents!`
        });
        setTimeout(() => {
          setShowModal(false);
          setModalFeedback(null);
          setManualData({
            name: '',
            email: '',
            github_handle: '',
            role_applied: 'Senior Backend Engineer',
            phone_number: '+917022683634'
          });
          fetchJobs();
        }, 1800);
      } else {
        setModalFeedback({ type: 'error', text: data.detail || 'Failed to dispatch candidate.' });
      }
    } catch (err) {
      setModalFeedback({ type: 'error', text: `Network error: ${err.message}` });
    } finally {
      setIsSubmitting(false);
    }
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
              GENIUS<span style={{ color: 'var(--accent-primary)' }}>AI</span>
            </h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '16px' }}>
              Autonomous Recruiting Engine
            </p>

            {/* Launch Candidate Modal Button */}
            <button
              onClick={() => { setShowModal(true); setModalFeedback(null); }}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                color: 'white',
                fontWeight: 800,
                fontSize: '0.85rem',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)',
                transition: 'all 0.2s ease'
              }}
            >
              ✨ Apply / Test Candidate
            </button>
          </div>

          <div style={{ padding: '0 24px 16px' }}>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Semantic RAG Search..."
                style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white', fontSize: '0.8rem', outline: 'none' }}
              />
              <button type="submit" disabled={isSearching} style={{ padding: '8px 12px', borderRadius: '8px', background: 'var(--accent-primary)', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}>
                {isSearching ? '...' : '🔍'}
              </button>
            </form>
          </div>

          <div style={{ padding: '0 12px' }}>
            {jobs.map(job => (
              <div 
                key={job.id} 
                className={`sidebar-item ${selectedJobId === job.id ? 'active' : ''}`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="sidebar-info" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                      {job.payload?.name || 'Loading...'}
                    </span>
                    {job.match_score && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--success)' }}>
                        {job.match_score}% Match
                      </span>
                    )}
                  </div>
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
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', gap: '12px' }}>
            <div style={{ fontSize: '2.5rem' }}>🤖</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>No Candidate Selected</div>
            <p style={{ fontSize: '0.9rem' }}>Click <strong>✨ Apply / Test Candidate</strong> to upload a resume or test a profile.</p>
          </div>
        ) : (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
              <div>
                <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '8px' }}>{selectedJob.payload?.name}</h2>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{selectedJob.role_applied}</span>
                  <span style={{ color: 'var(--text-dim)' }}>•</span>
                  <span style={{ color: 'var(--text-dim)' }}>{selectedJob.email}</span>
                  {selectedJob.payload?.github_handle && (
                    <>
                      <span style={{ color: 'var(--text-dim)' }}>•</span>
                      <a 
                        href={`https://github.com/${selectedJob.payload.github_handle}`} 
                        target="_blank" 
                        rel="noreferrer"
                        style={{ color: 'var(--accent-secondary)', textDecoration: 'none', fontWeight: 700 }}
                      >
                        github.com/{selectedJob.payload.github_handle}
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                {selectedJob.decision === 'STRONG_YES' && (
                  <div className="glass-card calendar-badge" style={{ padding: '12px 24px', textAlign: 'center', background: 'rgba(52, 211, 153, 0.1)', borderColor: 'rgba(52, 211, 153, 0.3)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 800 }}>Autonomously Handled</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      📅 Interview Scheduled
                    </div>
                  </div>
                )}

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
              <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>
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
                      <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{t.agent.toUpperCase()}</span>: {t.thought}
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
                      <span style={{ fontWeight: 800, color: 'var(--accent-primary)' }}>{value}/10</span>
                    </div>
                    <div className="score-bar-bg">
                      <div className="score-bar-fill" style={{ width: `${value * 10}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Evaluation Summary */}
            <div className="glass-card" style={{ padding: '32px', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--accent-primary)' }}>#</span> Executive Summary
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
                  <h4 style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: '12px', fontSize: '0.9rem' }}>CONCERNS</h4>
                  <ul style={{ listStyle: 'none' }}>
                    {selectedJob.evaluation?.concerns?.map((c, i) => (
                      <li key={i} style={{ marginBottom: '8px', fontSize: '0.95rem', display: 'flex', gap: '10px' }}>
                        <span style={{ color: 'var(--danger)' }}>!</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Agent Timeline */}
            <div style={{ marginBottom: '64px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '16px', letterSpacing: '2px' }}>
                AGENT TIMELINE
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {selectedJob.agent_steps?.map((step, i) => (
                  <div key={i} className="glass-card" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>
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
                      <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>Agent is researching candidate...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Apply / Test Candidate */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => !isSubmitting && setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff' }}>
                ✨ Test Candidate Application
              </h3>
              <button 
                onClick={() => setShowModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Tab switcher */}
            <div className="modal-tabs">
              <button 
                className={`modal-tab ${activeTab === 'resume' ? 'active' : ''}`}
                onClick={() => { setActiveTab('resume'); setModalFeedback(null); }}
              >
                📄 Resume Upload (PDF)
              </button>
              <button 
                className={`modal-tab ${activeTab === 'manual' ? 'active' : ''}`}
                onClick={() => { setActiveTab('manual'); setModalFeedback(null); }}
              >
                ✍️ Manual Details
              </button>
            </div>

            {/* Feedback notification banner */}
            {modalFeedback && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '12px',
                fontSize: '0.85rem',
                fontWeight: 600,
                marginBottom: '16px',
                background: modalFeedback.type === 'success' 
                  ? 'rgba(16, 185, 129, 0.15)' 
                  : modalFeedback.type === 'error'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(99, 102, 241, 0.15)',
                color: modalFeedback.type === 'success'
                  ? 'var(--success)'
                  : modalFeedback.type === 'error'
                  ? 'var(--danger)'
                  : 'var(--accent-primary)',
                border: `1px solid ${modalFeedback.type === 'success' ? 'var(--success)' : modalFeedback.type === 'error' ? 'var(--danger)' : 'var(--accent-primary)'}`
              }}>
                {modalFeedback.text}
              </div>
            )}

            {/* TAB 1: RESUME UPLOAD */}
            {activeTab === 'resume' ? (
              <form onSubmit={handleResumeSubmit}>
                <div 
                  className="dropzone"
                  onClick={() => document.getElementById('resumeFileInput').click()}
                >
                  <input 
                    type="file" 
                    id="resumeFileInput" 
                    accept=".pdf" 
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setResumeFile(e.target.files[0]);
                        setModalFeedback(null);
                      }
                    }}
                  />
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📁</div>
                  {resumeFile ? (
                    <div>
                      <div style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: '0.95rem' }}>
                        {resumeFile.name}
                      </div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '4px' }}>
                        {(resumeFile.size / 1024).toFixed(1)} KB — Click to change
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>
                        Drop candidate PDF resume here
                      </div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '4px' }}>
                        or click to browse from your device
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Target Role</label>
                  <select 
                    className="form-input"
                    value={resumeRole}
                    onChange={(e) => setResumeRole(e.target.value)}
                  >
                    <option value="Senior Backend Engineer">Senior Backend Engineer</option>
                    <option value="Junior Full-Stack Engineer">Junior Full-Stack Engineer</option>
                    <option value="AI/ML Systems Engineer">AI/ML Systems Engineer</option>
                    <option value="DevOps & Cloud Engineer">DevOps & Cloud Engineer</option>
                    <option value="Frontend Architect">Frontend Architect</option>
                  </select>
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmitting || !resumeFile}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '12px',
                    background: isSubmitting || !resumeFile ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                    color: isSubmitting || !resumeFile ? 'var(--text-dim)' : 'white',
                    border: 'none',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    cursor: isSubmitting || !resumeFile ? 'not-allowed' : 'pointer',
                    boxShadow: isSubmitting || !resumeFile ? 'none' : '0 4px 20px rgba(99, 102, 241, 0.4)',
                    marginTop: '12px'
                  }}
                >
                  {isSubmitting ? 'Parsing & Dispatching Agents...' : 'Extract & Launch Agents 🚀'}
                </button>
              </form>
            ) : (
              /* TAB 2: MANUAL ENTRY */
              <form onSubmit={handleManualSubmit}>
                <div className="form-group">
                  <label>Full Name</label>
                  <input 
                    className="form-input" 
                    placeholder="e.g. Alex Chen"
                    value={manualData.name}
                    onChange={(e) => setManualData({ ...manualData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Email Address</label>
                  <input 
                    className="form-input" 
                    type="email"
                    placeholder="e.g. alex.chen@example.com"
                    value={manualData.email}
                    onChange={(e) => setManualData({ ...manualData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>GitHub Handle (Optional but recommended)</label>
                  <input 
                    className="form-input" 
                    placeholder="e.g. simonw (without @ or url)"
                    value={manualData.github_handle}
                    onChange={(e) => setManualData({ ...manualData, github_handle: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Role Applied</label>
                  <select 
                    className="form-input"
                    value={manualData.role_applied}
                    onChange={(e) => setManualData({ ...manualData, role_applied: e.target.value })}
                  >
                    <option value="Senior Backend Engineer">Senior Backend Engineer</option>
                    <option value="Junior Full-Stack Engineer">Junior Full-Stack Engineer</option>
                    <option value="AI/ML Systems Engineer">AI/ML Systems Engineer</option>
                    <option value="DevOps & Cloud Engineer">DevOps & Cloud Engineer</option>
                    <option value="Frontend Architect">Frontend Architect</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Phone Number (for Voice Screen)</label>
                  <input 
                    className="form-input" 
                    placeholder="e.g. +917022683634"
                    value={manualData.phone_number}
                    onChange={(e) => setManualData({ ...manualData, phone_number: e.target.value })}
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                    color: 'white',
                    border: 'none',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
                    marginTop: '12px'
                  }}
                >
                  {isSubmitting ? 'Dispatching...' : 'Launch Autonomous Pipeline 🚀'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Connectivity Toast */}
      <div style={{ 
        position: 'fixed', 
        bottom: '24px', 
        right: '24px', 
        padding: '8px 16px', 
        borderRadius: '100px',
        fontSize: '0.75rem',
        fontWeight: 700,
        backgroundColor: wsStatus === 'connected' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.1)',
        color: wsStatus === 'connected' ? 'var(--success)' : 'var(--danger)',
        border: `1px solid ${wsStatus === 'connected' ? 'var(--success)' : 'var(--danger)'}`,
        backdropFilter: 'blur(10px)'
      }}>
        WS: {wsStatus.toUpperCase()}
      </div>
    </div>
  );
};

export default App;
