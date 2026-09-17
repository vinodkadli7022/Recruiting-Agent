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

// VAPI CONFIGURATION LOADED FROM ENVIRONMENT (NO KEYS IN CLIENT CODE)
const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY || "";
const vapi = VAPI_PUBLIC_KEY ? new Vapi(VAPI_PUBLIC_KEY) : null;

const App = () => {
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [callStatus, setCallStatus] = useState('inactive');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [queueFilter, setQueueFilter] = useState('all'); // all | awaiting_review | in_progress | completed
  const ws = useRef(null);

  // Modal & Application State
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState('resume'); // 'resume' | 'manual'
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeRole, setResumeRole] = useState('Senior Backend Engineer');
  const [resumeConsent, setResumeConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalFeedback, setModalFeedback] = useState(null);

  // Manual Form State
  const [manualData, setManualData] = useState({
    name: '',
    email: '',
    github_handle: '',
    role_applied: 'Senior Backend Engineer',
    phone_number: '+917022683634',
    voice_consent: false
  });

  // Outreach Edit State
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [isUpdatingDraft, setIsUpdatingDraft] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);

  // Auto-select first job
  useEffect(() => {
    if (jobs.length > 0 && !selectedJobId) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs]);

  useEffect(() => {
    fetchJobs();
    connectWebSocket();

    if (vapi) {
      vapi.on("call-start", () => setCallStatus('active'));
      vapi.on("call-end", () => setCallStatus('inactive'));
      vapi.on("error", (err) => {
        console.error("Vapi Error:", err);
        setCallStatus('inactive');
      });
    }

    return () => {
      ws.current?.close();
      vapi?.stop();
    };
  }, []);

  const handleTalkToAI = async (job) => {
    if (callStatus === 'active') {
      vapi?.stop();
      return;
    }

    setCallStatus('loading');
    const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID;
    if (!vapi || !assistantId) {
      setCallStatus('inactive');
      alert('Voice screening requires Vapi configuration and verified candidate consent.');
      return;
    }
    
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
      
      if (data.type === 'job_received' || data.type === 'review_required') {
        fetchJobs();
      }

      if (data.type === 'job_update' || data.type === 'status_update' || data.type === 'job_complete' || data.type === 'review_required') {
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

  // Recruiter Review Action (Approve / Reject)
  const handleReview = async (approved) => {
    if (!selectedJob) return;
    setIsReviewing(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/${selectedJob.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, reviewer: 'recruiter-dashboard' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Review action failed');
      await fetchJobs();
    } catch (err) {
      alert(`Review action failed: ${err.message}`);
    } finally {
      setIsReviewing(false);
    }
  };

  // Resume Upload Handler
  const handleResumeSubmit = async (e) => {
    e.preventDefault();
    if (!resumeFile) {
      setModalFeedback({ type: 'error', text: 'Please select a PDF resume file.' });
      return;
    }

    setIsSubmitting(true);
    setModalFeedback({ type: 'info', text: 'Extracting candidate evidence via AI copilot...' });

    const formData = new FormData();
    formData.append('file', resumeFile);
    formData.append('role_applied', resumeRole);
    formData.append('voice_consent', resumeConsent);

    try {
      const res = await fetch(`${API_BASE}/webhook/resume`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setModalFeedback({
          type: 'success',
          text: `Evidence extracted: ${data.extracted?.name} (@${data.extracted?.github_handle || 'no-gh'}). Dispatched for copilot evaluation!`
        });
        setTimeout(() => {
          setShowModal(false);
          setModalFeedback(null);
          setResumeFile(null);
          fetchJobs();
        }, 2000);
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
    setModalFeedback({ type: 'info', text: 'Ingesting applicant payload...' });

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
          text: `Applicant ${manualData.name} submitted for evaluation!`
        });
        setTimeout(() => {
          setShowModal(false);
          setModalFeedback(null);
          setManualData({
            name: '',
            email: '',
            github_handle: '',
            role_applied: 'Senior Backend Engineer',
            phone_number: '+917022683634',
            voice_consent: false
          });
          fetchJobs();
        }, 1800);
      } else {
        setModalFeedback({ type: 'error', text: data.detail || 'Failed to dispatch applicant.' });
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

  // Sync draft text on job selection
  useEffect(() => {
    if (selectedJob?.evaluation) {
      setDraftSubject(selectedJob.evaluation.draft_email_subject || `Next Steps: ${selectedJob.role_applied} at Engineering`);
      setDraftBody(
        selectedJob.evaluation.draft_email_body || 
        (selectedJob.outcome?.email_preview || `Hi ${selectedJob.payload?.name || 'there'},\n\nWe reviewed your technical background and were impressed by your projects. We would love to discuss the ${selectedJob.role_applied} role with you.`)
      );
    }
  }, [selectedJob]);

  // Filtered Queue
  const filteredJobs = jobs.filter(job => {
    if (queueFilter === 'awaiting_review') return job.status === 'awaiting_review';
    if (queueFilter === 'in_progress') return ['received', 'researching', 'reasoning', 'acting'].includes(job.status);
    if (queueFilter === 'completed') return job.status === 'complete';
    return true;
  });

  const awaitingCount = jobs.filter(j => j.status === 'awaiting_review').length;

  return (
    <div className="app-container">
      {/* Sidebar Container */}
      <div className="sidebar-container">
        <div className="glass-card" style={{ height: '100%', overflowY: 'auto' }}>
          <div style={{ padding: '24px' }}>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-1px', marginBottom: '2px' }}>
              GENIUS<span style={{ color: 'var(--accent-primary)' }}>AI</span>
            </h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '14px' }}>
              Recruiting Copilot
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
              📄 Ingest Candidate / Resume
            </button>
          </div>

          {/* Review Queue Filters */}
          <div className="queue-filter-bar">
            <button 
              className={`queue-tab ${queueFilter === 'all' ? 'active' : ''}`}
              onClick={() => setQueueFilter('all')}
            >
              All ({jobs.length})
            </button>
            <button 
              className={`queue-tab ${queueFilter === 'awaiting_review' ? 'active' : ''}`}
              onClick={() => setQueueFilter('awaiting_review')}
              style={{ borderColor: awaitingCount > 0 ? '#f59e0b' : 'inherit' }}
            >
              Review Queue {awaitingCount > 0 && `(${awaitingCount})`}
            </button>
            <button 
              className={`queue-tab ${queueFilter === 'in_progress' ? 'active' : ''}`}
              onClick={() => setQueueFilter('in_progress')}
            >
              Running
            </button>
            <button 
              className={`queue-tab ${queueFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setQueueFilter('completed')}
            >
              Done
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
            {filteredJobs.map(job => (
              <div 
                key={job.id} 
                className={`sidebar-item ${selectedJobId === job.id ? 'active' : ''}`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="sidebar-info" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                      {job.payload?.name || 'Loading...'}
                    </span>
                    {job.match_score && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--success)' }}>
                        {job.match_score}%
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                      {job.role_applied || 'Unknown Role'}
                    </p>
                    {job.status === 'awaiting_review' && (
                      <span style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 800, background: 'rgba(245, 158, 11, 0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                        NEEDS REVIEW
                      </span>
                    )}
                  </div>
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
            <div style={{ fontSize: '2.5rem' }}>📋</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>Select a Candidate from the Queue</div>
            <p style={{ fontSize: '0.9rem' }}>Use <strong>📄 Ingest Candidate / Resume</strong> to begin evidence extraction.</p>
          </div>
        ) : (
          <div style={{ maxWidth: '920px', margin: '0 auto' }}>
            {/* Candidate Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div>
                <h2 style={{ fontSize: '2.3rem', fontWeight: 800, marginBottom: '6px' }}>{selectedJob.payload?.name}</h2>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                  {selectedJob.payload?.voice_consent && (
                    <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)', padding: '2px 8px', borderRadius: '100px', fontWeight: 700 }}>
                      ✓ Voice Consented
                    </span>
                  )}
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {selectedJob.decision === 'STRONG_YES' && selectedJob.review_status === 'approved' && (
                  <div className="glass-card calendar-badge" style={{ padding: '10px 18px', textAlign: 'center', background: 'rgba(52, 211, 153, 0.1)', borderColor: 'rgba(52, 211, 153, 0.3)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--success)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 800 }}>Recruiter Approved</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      📅 Scheduling link sent
                    </div>
                  </div>
                )}

                {selectedJob.payload?.voice_consent && (selectedJob.decision === 'STRONG_YES' || selectedJob.decision === 'SOFT_YES') && (
                  <button 
                    onClick={() => handleTalkToAI(selectedJob)}
                    className={`btn-voice ${callStatus === 'active' ? 'active' : ''}`}
                    disabled={callStatus === 'loading'}
                  >
                    {callStatus === 'loading' ? 'Connecting...' : 
                     callStatus === 'active' ? '⏹ End Call' : '🎙 Start Consented Technical Screen'}
                  </button>
                )}

                <div className="glass-card" style={{ padding: '10px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '2px' }}>CONFIDENCE</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--success)' }}>
                    {selectedJob.evaluation?.confidence_score || 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* HUMAN-IN-THE-LOOP RECRUITER REVIEW GATE */}
            {selectedJob.status === 'awaiting_review' && (
              <div className="review-gate-card">
                <div className="review-gate-header">
                  <div className="review-gate-title">
                    <span>🛡️</span> Recruiter Review Required
                  </div>
                  <div className="review-actions">
                    <button 
                      onClick={() => handleReview(true)} 
                      disabled={isReviewing}
                      className="btn-approve"
                    >
                      {isReviewing ? 'Processing...' : '✓ Approve & Send Actions'}
                    </button>
                    <button 
                      onClick={() => handleReview(false)} 
                      disabled={isReviewing}
                      className="btn-reject"
                    >
                      Reject Recommendation
                    </button>
                  </div>
                </div>

                <p style={{ fontSize: '0.85rem', color: '#e2e8f0', lineHeight: 1.5, marginBottom: '10px' }}>
                  AI evaluation complete. All outbound outreach, Slack alerts, and ticket creation are <strong>paused</strong> pending your review. 
                  <span style={{ color: '#f59e0b', marginLeft: '6px' }}>
                    (Safe Default: DRY_RUN is active — no real emails or calls are dispatched without explicit configuration.)
                  </span>
                </p>

                {/* Editable Outreach Draft Box */}
                <div className="outreach-editor">
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-dim)', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Draft Outreach Preview (Recipient: {selectedJob.email})
                  </div>
                  <textarea 
                    className="outreach-textarea"
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder="Candidate email draft..."
                  />
                </div>
              </div>
            )}

            {/* Live Activity Log */}
            <div className="glass-card" style={{ padding: '18px', marginBottom: '28px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '10px', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Live Copilot Activity Log
              </h3>
              <div 
                ref={thoughtsRef}
                style={{ 
                  height: '110px', 
                  overflowY: 'auto', 
                  fontFamily: 'JetBrains Mono, monospace', 
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  padding: '10px',
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: '10px'
                }}
              >
                {selectedJob.thoughts?.length > 0 ? (
                  selectedJob.thoughts.map((t, i) => (
                    <div key={i} style={{ marginBottom: '5px', color: 'var(--text-main)' }}>
                      <span style={{ color: 'var(--text-dim)' }}>[{new Date(t.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>{' '}
                      <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{t.agent.toUpperCase()}</span>: {t.thought}
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Operational activity events will appear here...</div>
                )}
              </div>
            </div>

            {/* Evidence-Linked Scorecard Grid */}
            {selectedJob.evaluation?.scorecard && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
                {Object.entries(selectedJob.evaluation.scorecard).map(([key, item]) => {
                  const scoreValue = typeof item === 'object' ? item.score : item;
                  const explanation = typeof item === 'object' ? item.explanation : null;
                  const evidenceList = typeof item === 'object' ? (item.evidence || []) : [];
                  const missingList = typeof item === 'object' ? (item.missing_evidence || []) : [];

                  return (
                    <div key={key} className="glass-card" style={{ padding: '18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ textTransform: 'capitalize', fontWeight: 700, fontSize: '0.88rem' }}>
                          {key.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontWeight: 800, color: 'var(--accent-primary)' }}>{scoreValue}/10</span>
                      </div>
                      
                      <div className="score-bar-bg" style={{ marginBottom: explanation ? '10px' : '0' }}>
                        <div className="score-bar-fill" style={{ width: `${scoreValue * 10}%` }}></div>
                      </div>

                      {explanation && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-main)', lineHeight: 1.4, marginTop: '8px' }}>
                          {explanation}
                        </p>
                      )}

                      {/* Evidence Citations */}
                      {evidenceList.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          {evidenceList.map((ev, idx) => (
                            <div key={idx} className="evidence-pill">
                              <span>📌 [{ev.source_type?.toUpperCase()}]: {ev.quote || ev.locator}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Missing Evidence Note */}
                      {missingList.length > 0 && (
                        <div style={{ marginTop: '6px' }}>
                          {missingList.map((mis, idx) => (
                            <div key={idx} className="missing-evidence-tag">
                              <span>⚠️ Unverified: {mis}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Executive Evaluation Summary */}
            <div className="glass-card" style={{ padding: '28px', marginBottom: '28px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--accent-primary)' }}>#</span> Evidence Synthesis
              </h3>
              <p style={{ lineHeight: 1.6, color: 'var(--text-main)', fontSize: '1rem', marginBottom: '28px' }}>
                {selectedJob.evaluation?.summary}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px' }}>
                <div>
                  <h4 style={{ color: 'var(--success)', fontWeight: 700, marginBottom: '10px', fontSize: '0.85rem', letterSpacing: '0.5px' }}>
                    KEY EVIDENCE & STRENGTHS
                  </h4>
                  <ul style={{ listStyle: 'none' }}>
                    {selectedJob.evaluation?.strengths?.map((s, i) => (
                      <li key={i} style={{ marginBottom: '8px', fontSize: '0.9rem', display: 'flex', gap: '8px' }}>
                        <span style={{ color: 'var(--success)' }}>✓</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: '10px', fontSize: '0.85rem', letterSpacing: '0.5px' }}>
                    AREAS TO PROBE IN INTERVIEW
                  </h4>
                  <ul style={{ listStyle: 'none' }}>
                    {selectedJob.evaluation?.concerns?.map((c, i) => (
                      <li key={i} style={{ marginBottom: '8px', fontSize: '0.9rem', display: 'flex', gap: '8px' }}>
                        <span style={{ color: 'var(--danger)' }}>!</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Agent Timeline */}
            <div style={{ marginBottom: '48px' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-dim)', marginBottom: '14px', letterSpacing: '2px' }}>
                AUDITABLE WORKFLOW TIMELINE
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {selectedJob.agent_steps?.map((step, i) => (
                  <div key={i} className="glass-card" style={{ padding: '14px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                          {step.agent}
                        </span>
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{step.step}</span>
                      </div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                        {step.status === 'running' ? 'Processing...' : 'Complete'}
                      </span>
                    </div>
                  </div>
                ))}
                {selectedJob.status === 'awaiting_review' && (
                  <div className="glass-card" style={{ padding: '14px', background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ color: '#f59e0b', fontSize: '1rem' }}>⏸</span>
                      <span style={{ fontWeight: 600, color: '#f59e0b', fontSize: '0.85rem' }}>
                        Workflow paused at Review Gate. Awaiting recruiter approval to execute prepared outreach.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Ingest Candidate / Resume */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => !isSubmitting && setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>
                📄 Ingest Candidate Application
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
                ✍️ Manual Payload
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
                        {(resumeFile.size / 1024).toFixed(1)} KB — Click to replace
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

                <div style={{ margin: '14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="resumeConsentCheck"
                    checked={resumeConsent}
                    onChange={(e) => setResumeConsent(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="resumeConsentCheck" style={{ fontSize: '0.82rem', color: 'var(--text-dim)', cursor: 'pointer' }}>
                    Candidate consented to optional technical voice screen
                  </label>
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
                    marginTop: '10px'
                  }}
                >
                  {isSubmitting ? 'Parsing & Dispatching...' : 'Extract Evidence & Evaluate 🚀'}
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
                  <label>GitHub Handle</label>
                  <input 
                    className="form-input" 
                    placeholder="e.g. simonw"
                    value={manualData.github_handle}
                    onChange={(e) => setManualData({ ...manualData, github_handle: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Target Role</label>
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

                <div style={{ margin: '14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="manualConsentCheck"
                    checked={manualData.voice_consent}
                    onChange={(e) => setManualData({ ...manualData, voice_consent: e.target.checked })}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="manualConsentCheck" style={{ fontSize: '0.82rem', color: 'var(--text-dim)', cursor: 'pointer' }}>
                    Candidate consented to optional technical voice screen
                  </label>
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
                    marginTop: '10px'
                  }}
                >
                  {isSubmitting ? 'Dispatching...' : 'Start Copilot Pipeline 🚀'}
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
        border: `1px solid ${wsStatus === 'connected' ? 'var(--success)' : 'var(--error)'}`,
        backdropFilter: 'blur(10px)'
      }}>
        WS: {wsStatus.toUpperCase()}
      </div>
    </div>
  );
};

export default App;
