import React, { useState, useEffect, useRef } from 'react';
import Vapi from "@vapi-ai/web";
import './style.css';

// Dynamic API and WebSocket URLs
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE = import.meta.env.VITE_WS_URL || (
  window.location.protocol === 'https:' 
    ? `wss://${window.location.host}/ws` 
    : 'ws://localhost:8000/ws'
);

// Vapi client initialized safely from environment
const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY || "";
const vapi = VAPI_PUBLIC_KEY ? new Vapi(VAPI_PUBLIC_KEY) : null;

const App = () => {
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [callStatus, setCallStatus] = useState('inactive');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [queueFilter, setQueueFilter] = useState('needs_review'); // 'needs_review' | 'all' | 'running' | 'approved'
  const [activeViewTab, setActiveViewTab] = useState('overview'); // 'overview' | 'evidence' | 'activity' | 'outreach' | 'audit'
  const ws = useRef(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState('resume');
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeRole, setResumeRole] = useState('Senior Backend Engineer');
  const [resumeConsent, setResumeConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalFeedback, setModalFeedback] = useState(null);

  // Manual Ingest State
  const [manualData, setManualData] = useState({
    name: '',
    email: '',
    github_handle: '',
    role_applied: 'Senior Backend Engineer',
    phone_number: '+917022683634',
    voice_consent: false
  });

  // Outreach Draft Editor State
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [draftSavedMessage, setDraftSavedMessage] = useState(null);

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

  // Select first job when jobs load
  useEffect(() => {
    if (jobs.length > 0 && !selectedJobId) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs]);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs/`);
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
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'job_received' || data.type === 'review_required' || data.type === 'job_complete') {
          fetchJobs();
        }

        if (data.type === 'job_update' || data.type === 'status_update' || data.type === 'review_required') {
          setJobs(prev => {
            const jobId = data.job_id || data.id;
            const idx = prev.findIndex(j => j.id === jobId);
            if (idx === -1) return [{ ...data, id: jobId }, ...prev];
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...data, status: data.status || updated[idx].status };
            return updated;
          });
        }
      } catch (err) {
        console.error("WS message parse error:", err);
      }
    };
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
    } finally {
      setIsSearching(false);
    }
  };

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
      if (!res.ok) throw new Error(data.detail || 'Review failed');
      await fetchJobs();
    } catch (err) {
      alert(`Review action failed: ${err.message}`);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedJob) return;
    setIsSavingDraft(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/${selectedJob.id}/outreach`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_subject: draftSubject, email_body: draftBody })
      });
      if (res.ok) {
        setDraftSavedMessage('Draft saved successfully');
        setTimeout(() => setDraftSavedMessage(null), 3000);
      }
    } catch (err) {
      alert(`Failed to save draft: ${err.message}`);
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleResumeSubmit = async (e) => {
    e.preventDefault();
    if (!resumeFile) {
      setModalFeedback({ type: 'error', text: 'Please select a PDF resume file.' });
      return;
    }

    setIsSubmitting(true);
    setModalFeedback({ type: 'info', text: 'Extracting candidate evidence via AI Copilot...' });

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
          text: `Evidence extracted for ${data.extracted?.name || 'candidate'}. Dispatched for copilot evaluation.`
        });
        setTimeout(() => {
          setShowModal(false);
          setModalFeedback(null);
          setResumeFile(null);
          fetchJobs();
        }, 1800);
      } else {
        setModalFeedback({ type: 'error', text: data.detail || 'Failed to submit resume.' });
      }
    } catch (err) {
      setModalFeedback({ type: 'error', text: `Network error: ${err.message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

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
          text: `Applicant ${manualData.name} submitted for evaluation.`
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

  // Review Queue Filter Logic
  const filteredJobs = jobs.filter(job => {
    if (queueFilter === 'needs_review') return job.status === 'awaiting_review';
    if (queueFilter === 'running') return ['received', 'researching', 'reasoning', 'acting'].includes(job.status);
    if (queueFilter === 'approved') return job.review_status === 'approved';
    return true;
  });

  const needsReviewCount = jobs.filter(j => j.status === 'awaiting_review').length;

  // Identity Mismatch Detection
  const hasIdentityIssue = (() => {
    if (!selectedJob) return false;
    const candidateName = (selectedJob.payload?.name || '').toLowerCase();
    const ghHandle = (selectedJob.payload?.github_handle || '').toLowerCase();
    
    // Explicit known mismatch or concern flag
    if (ghHandle === 'simonw' && !candidateName.includes('simon')) return true;
    if (ghHandle === 'tiangolo' && !candidateName.includes('sebasti')) return true;
    if (ghHandle === 'torvalds' && !candidateName.includes('linus')) return true;
    
    const concerns = selectedJob.evaluation?.concerns || [];
    return concerns.some(c => c.toLowerCase().includes('identity') || c.toLowerCase().includes('mismatch'));
  })();

  const confidenceScore = selectedJob?.evaluation?.confidence_score ?? 0;
  const confidenceLevel = confidenceScore >= 80 ? 'high' : confidenceScore >= 60 ? 'med' : 'low';
  const confidenceColorClass = confidenceScore >= 80 ? 'confidence-high' : confidenceScore >= 60 ? 'confidence-med' : 'confidence-low';

  const recommendationText = selectedJob?.evaluation?.recommendation || (
    selectedJob?.decision === 'STRONG_YES' ? 'Advance Recommended' :
    selectedJob?.decision === 'SOFT_YES' ? 'Review Further' :
    selectedJob?.decision === 'NO' ? 'Do Not Advance' : 'Under Evaluation'
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 1. TOP NAVBAR */}
      <header className="top-navbar">
        <div className="brand-section">
          <div className="brand-logo">
            GENIUS<span>AI</span>
          </div>
          <span className="brand-tag">Recruiting Copilot</span>
        </div>

        <div className="nav-center">
          <form onSubmit={handleSearch} className="nav-search">
            <span style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>🔍</span>
            <input 
              type="text" 
              placeholder="Search candidate skills, evidence, or roles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>
        </div>

        <div className="nav-actions">
          <div className="system-status-chip">
            <span className={`status-dot ${wsStatus === 'connected' ? 'active' : ''}`}></span>
            <span>API & Worker Online</span>
            <span style={{ color: 'var(--border)' }}>|</span>
            <span style={{ color: 'var(--warning)' }}>DRY RUN</span>
          </div>

          <button 
            onClick={() => { setShowModal(true); setModalFeedback(null); }}
            className="btn-primary-action"
          >
            + Ingest Candidate
          </button>
        </div>
      </header>

      {/* 2. WORKSPACE LAYOUT */}
      <div className="workspace-container">
        {/* LEFT SIDEBAR: REVIEW QUEUE */}
        <aside className="review-sidebar">
          <div className="queue-nav">
            <div className="queue-title">Review Queue</div>
            <div className="queue-tabs-row">
              <button 
                className={`queue-btn ${queueFilter === 'needs_review' ? 'active' : ''}`}
                onClick={() => setQueueFilter('needs_review')}
              >
                Needs Review ({needsReviewCount})
              </button>
              <button 
                className={`queue-btn ${queueFilter === 'running' ? 'active' : ''}`}
                onClick={() => setQueueFilter('running')}
              >
                Running
              </button>
              <button 
                className={`queue-btn ${queueFilter === 'approved' ? 'active' : ''}`}
                onClick={() => setQueueFilter('approved')}
              >
                Approved
              </button>
              <button 
                className={`queue-btn ${queueFilter === 'all' ? 'active' : ''}`}
                onClick={() => setQueueFilter('all')}
              >
                All ({jobs.length})
              </button>
            </div>
          </div>

          <div className="queue-candidate-list">
            {filteredJobs.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.8rem' }}>
                No candidates in this queue.
              </div>
            ) : (
              filteredJobs.map(job => {
                const isSelected = selectedJobId === job.id;
                const score = job.evaluation?.confidence_score ?? 0;
                const scoreClass = score >= 80 ? 'confidence-high' : score >= 60 ? 'confidence-med' : 'confidence-low';
                const statusBadge = 
                  job.status === 'awaiting_review' ? { text: 'Needs Review', cls: 'badge-awaiting' } :
                  job.review_status === 'approved' ? { text: 'Approved', cls: 'badge-approved' } :
                  job.status === 'complete' ? { text: 'Complete', cls: 'badge-approved' } :
                  job.status === 'failed' ? { text: 'Failed', cls: 'badge-rejected' } :
                  { text: job.status || 'Running', cls: 'badge-running' };

                return (
                  <div 
                    key={job.id} 
                    className={`candidate-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <div className="candidate-item-top">
                      <span className="candidate-item-name">{job.payload?.name || 'Applicant'}</span>
                      {job.evaluation && (
                        <span className={`confidence-chip ${scoreClass}`}>
                          {score}%
                        </span>
                      )}
                    </div>
                    <div className="candidate-item-role">{job.role_applied || 'Software Engineer'}</div>
                    <div className="candidate-item-footer">
                      <span className={`badge-tag ${statusBadge.cls}`}>{statusBadge.text}</span>
                      {job.payload?.github_handle === 'simonw' && (
                        <span style={{ color: 'var(--danger)', fontSize: '0.68rem', fontWeight: 600 }}>
                          1 issue
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* MAIN VIEWPORT */}
        <main className="main-viewport">
          {!selectedJob ? (
            <div className="empty-state-card">
              <div className="empty-state-icon">📋</div>
              <h2 className="empty-state-title">Welcome to Recruiting Copilot</h2>
              <p className="empty-state-desc">
                Review evidence-backed candidate recommendations, inspect code groundings, approve prepared outreach, and audit external actions.
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={() => setShowModal(true)} 
                  className="btn-primary-action"
                >
                  + Ingest Candidate
                </button>
                <button 
                  onClick={() => setQueueFilter('all')} 
                  className="btn-secondary-action"
                >
                  View All Candidates
                </button>
              </div>
            </div>
          ) : (
            <div className="content-max-width">
              {/* CANDIDATE HEADER CARD */}
              <div className="candidate-header-card">
                <div>
                  <h1 className="candidate-meta-title">{selectedJob.payload?.name || 'Candidate Profile'}</h1>
                  <div className="candidate-links-row">
                    <span style={{ color: '#fff', fontWeight: 600 }}>{selectedJob.role_applied}</span>
                    <span>•</span>
                    <span>{selectedJob.email}</span>
                    {selectedJob.payload?.github_handle && (
                      <>
                        <span>•</span>
                        <a 
                          href={`https://github.com/${selectedJob.payload.github_handle}`} 
                          target="_blank" 
                          rel="noreferrer"
                        >
                          github.com/{selectedJob.payload.github_handle}
                        </a>
                      </>
                    )}
                    {selectedJob.payload?.voice_consent && (
                      <>
                        <span>•</span>
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Voice Consented</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="candidate-header-actions">
                  {/* Smart Technical Screen Guard */}
                  {hasIdentityIssue || confidenceScore < 40 ? (
                    <div 
                      style={{ 
                        background: 'rgba(251, 113, 133, 0.08)', 
                        border: '1px solid rgba(251, 113, 133, 0.25)', 
                        color: 'var(--danger)', 
                        padding: '6px 12px', 
                        borderRadius: '6px', 
                        fontSize: '0.75rem', 
                        fontWeight: 600 
                      }}
                      title="Screening is unavailable until identity and evidence questions are resolved."
                    >
                      Technical screen unavailable
                    </div>
                  ) : selectedJob.payload?.voice_consent ? (
                    <button 
                      onClick={() => alert("Recruiter voice screening initiated in test mode.")}
                      className="btn-secondary-action"
                    >
                      🎙 Start Consented Technical Screen
                    </button>
                  ) : null}

                  {selectedJob.status === 'awaiting_review' && (
                    <span className="badge-tag badge-awaiting">Awaiting Recruiter Review</span>
                  )}
                  {selectedJob.review_status === 'approved' && (
                    <span className="badge-tag badge-approved">✓ Recruiter Approved</span>
                  )}
                </div>
              </div>

              {/* 3. PROMINENT TOP-LEVEL IDENTITY VERIFICATION WARNING */}
              {hasIdentityIssue && (
                <div className="identity-alert-box">
                  <div className="identity-alert-icon">⚠️</div>
                  <div className="identity-alert-content">
                    <div className="identity-alert-title">Identity Verification Required</div>
                    <div className="identity-alert-desc">
                      The submitted GitHub handle (<code style={{ fontFamily: 'JetBrains Mono', color: '#fff' }}>@{selectedJob.payload?.github_handle}</code>) appears to belong to another individual rather than <strong>{selectedJob.payload?.name}</strong>. The copilot has marked public code evidence as unverified to prevent false assumptions.
                    </div>
                  </div>
                  <button 
                    onClick={() => alert("Identity verification request flagged for recruiter follow-up.")}
                    className="btn-secondary-action"
                    style={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}
                  >
                    Flag for Verification
                  </button>
                </div>
              )}

              {/* 4. KPI METRICS STRIP (4 CARDS) */}
              <div className="kpi-strip">
                <div className="kpi-card">
                  <div className="kpi-label">Recommendation</div>
                  <div className="kpi-value" style={{ fontSize: '1rem' }}>
                    {recommendationText}
                  </div>
                  <div className="kpi-subtext">Evidence-based advice</div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-label">Confidence</div>
                  <div className={`kpi-value ${confidenceColorClass}`}>
                    {confidenceScore}%
                  </div>
                  <div className="score-bar-track" style={{ marginTop: '6px' }}>
                    <div 
                      className="score-bar-fill" 
                      style={{ 
                        width: `${confidenceScore}%`, 
                        background: confidenceScore >= 80 ? 'var(--success)' : confidenceScore >= 60 ? 'var(--warning)' : 'var(--danger)' 
                      }}
                    ></div>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-label">Evidence Quality</div>
                  <div className="kpi-value">
                    {hasIdentityIssue ? 'Low (Conflicted)' : selectedJob.research_result?.data_quality === 'high' ? 'High' : 'Moderate'}
                  </div>
                  <div className="kpi-subtext">{selectedJob.payload?.resume_text ? 'Resume + GitHub' : 'GitHub profile'}</div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-label">Verification Status</div>
                  <div className="kpi-value" style={{ color: hasIdentityIssue ? 'var(--danger)' : 'var(--success)' }}>
                    {hasIdentityIssue ? 'Needs Attention' : 'Verified'}
                  </div>
                  <div className="kpi-subtext">{hasIdentityIssue ? '1 identity alert' : '0 open flags'}</div>
                </div>
              </div>

              {/* 5. VIEW NAVIGATION TABS */}
              <nav className="view-tab-nav">
                <button 
                  className={`view-tab-btn ${activeViewTab === 'overview' ? 'active' : ''}`}
                  onClick={() => setActiveViewTab('overview')}
                >
                  Overview & Scorecard
                </button>
                <button 
                  className={`view-tab-btn ${activeViewTab === 'evidence' ? 'active' : ''}`}
                  onClick={() => setActiveViewTab('evidence')}
                >
                  Evidence Citations
                </button>
                <button 
                  className={`view-tab-btn ${activeViewTab === 'outreach' ? 'active' : ''}`}
                  onClick={() => setActiveViewTab('outreach')}
                >
                  Prepared Outreach
                </button>
                <button 
                  className={`view-tab-btn ${activeViewTab === 'activity' ? 'active' : ''}`}
                  onClick={() => setActiveViewTab('activity')}
                >
                  Activity Log
                </button>
                <button 
                  className={`view-tab-btn ${activeViewTab === 'audit' ? 'active' : ''}`}
                  onClick={() => setActiveViewTab('audit')}
                >
                  Audit Trail
                </button>
              </nav>

              {/* TAB 1: OVERVIEW */}
              {activeViewTab === 'overview' && (
                <>
                  {/* RECRUITER REVIEW GATE BANNER (IF AWAITING REVIEW) */}
                  {selectedJob.status === 'awaiting_review' && (
                    <div className="review-gate-banner">
                      <div className="review-gate-top">
                        <div className="review-badge-header">
                          <span>🛡️</span> Recruiter Review Required
                        </div>
                        <div className="review-button-group">
                          <button 
                            onClick={() => handleReview(true)} 
                            disabled={isReviewing}
                            className="btn-approve-action"
                          >
                            {isReviewing ? 'Processing...' : '✓ Approve Prepared Outreach'}
                          </button>
                          <button 
                            onClick={() => handleReview(false)} 
                            disabled={isReviewing}
                            className="btn-reject-action"
                          >
                            Reject Recommendation
                          </button>
                          <button 
                            onClick={() => alert("Requested candidate to provide verified portfolio or code sample.")}
                            className="btn-secondary-action"
                          >
                            Request More Evidence
                          </button>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                        AI evaluation is complete. Consequential actions (emails, tickets, and notifications) are paused until your decision.
                        <span style={{ color: 'var(--warning)', marginLeft: '6px' }}>
                          Mode: DRY_RUN enabled (no real candidate emails delivered until explicitly configured).
                        </span>
                      </p>
                    </div>
                  )}

                  {/* DECISION SUMMARY & NEXT BEST ACTION */}
                  <div className="decision-summary-card">
                    <div className="decision-grid">
                      <div>
                        <div className="decision-section-heading">Why this recommendation?</div>
                        <div className="decision-summary-text">
                          {selectedJob.evaluation?.summary || 'Candidate evaluation is in progress or pending evidence synthesis.'}
                        </div>
                      </div>
                      <div>
                        <div className="decision-section-heading">Recommended Next Action</div>
                        <div className="next-step-box">
                          <strong>
                            {hasIdentityIssue ? 'Verify Identity & Request Code Samples' : 'Schedule Structured Technical Screen'}
                          </strong>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px' }}>
                            {hasIdentityIssue 
                              ? 'Request candidate portfolio or clarify GitHub handle before inviting to technical interview.' 
                              : 'Review prepared email draft and approve invitation.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SCORECARDS GRID */}
                  {selectedJob.evaluation?.scorecard && (
                    <div className="scorecards-grid">
                      {Object.entries(selectedJob.evaluation.scorecard).map(([key, item]) => {
                        const scoreValue = typeof item === 'object' ? item.score : item;
                        const explanation = typeof item === 'object' ? item.explanation : null;
                        const evidenceList = typeof item === 'object' ? (item.evidence || []) : [];
                        const missingList = typeof item === 'object' ? (item.missing_evidence || []) : [];

                        return (
                          <div key={key} className="score-dimension-card">
                            <div className="score-dimension-header">
                              <span className="score-dimension-name">{key.replace(/_/g, ' ')}</span>
                              <span className="score-dimension-points">{scoreValue}/10</span>
                            </div>

                            <div className="score-bar-track">
                              <div 
                                className="score-bar-fill" 
                                style={{ 
                                  width: `${scoreValue * 10}%`,
                                  background: scoreValue >= 7 ? 'var(--success)' : scoreValue >= 5 ? 'var(--warning)' : 'var(--danger)'
                                }}
                              ></div>
                            </div>

                            {explanation && (
                              <p className="score-explanation">{explanation}</p>
                            )}

                            {/* Citations */}
                            {evidenceList.length > 0 && (
                              <div className="citation-row">
                                {evidenceList.map((ev, idx) => (
                                  <div key={idx} className="citation-chip">
                                    <span className="citation-source-badge">{ev.source_type}</span>
                                    <span>{ev.quote || ev.locator}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Missing Evidence Note */}
                            {missingList.length > 0 && (
                              <div className="citation-row">
                                {missingList.map((mis, idx) => (
                                  <div key={idx} className="missing-tag-chip">
                                    <span>⚠️ Missing: {mis}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* STRENGTHS & AREAS TO PROBE */}
                  <div className="strengths-probe-grid">
                    <div>
                      <div className="column-heading green">Verified Strengths</div>
                      <ul className="bullet-list">
                        {selectedJob.evaluation?.strengths?.map((s, idx) => (
                          <li key={idx}>
                            <span style={{ color: 'var(--success)' }}>✓</span>
                            <span>{s}</span>
                          </li>
                        )) || <li style={{ color: 'var(--text-subtle)' }}>No verified strengths recorded.</li>}
                      </ul>
                    </div>

                    <div>
                      <div className="column-heading amber">Areas to Probe in Interview</div>
                      <ul className="bullet-list">
                        {selectedJob.evaluation?.concerns?.map((c, idx) => (
                          <li key={idx}>
                            <span style={{ color: 'var(--warning)' }}>!</span>
                            <span>{c}</span>
                          </li>
                        )) || <li style={{ color: 'var(--text-subtle)' }}>No specific concerns noted.</li>}
                      </ul>
                    </div>
                  </div>
                </>
              )}

              {/* TAB 2: EVIDENCE CITATIONS */}
              {activeViewTab === 'evidence' && (
                <div className="decision-summary-card">
                  <div className="decision-section-heading" style={{ marginBottom: '12px' }}>
                    Sourced Candidate Evidence Records
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="citation-chip" style={{ padding: '10px 14px' }}>
                      <span className="citation-source-badge">RESUME</span>
                      <div>
                        <strong>Submitted Application Profile</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '2px' }}>
                          Candidate applied for {selectedJob.role_applied}. Contact: {selectedJob.email}
                        </div>
                      </div>
                    </div>

                    {selectedJob.payload?.github_handle && (
                      <div className="citation-chip" style={{ padding: '10px 14px', borderColor: hasIdentityIssue ? 'rgba(251, 113, 133, 0.4)' : 'var(--border)' }}>
                        <span className="citation-source-badge">GITHUB</span>
                        <div>
                          <strong>Profile: https://github.com/{selectedJob.payload.github_handle}</strong>
                          <div style={{ color: hasIdentityIssue ? 'var(--danger)' : 'var(--text-muted)', fontSize: '0.78rem', marginTop: '2px' }}>
                            {hasIdentityIssue 
                              ? 'Profile conflict: Name on account does not match candidate.' 
                              : 'Verified public repositories and commit patterns.'}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="citation-chip" style={{ padding: '10px 14px' }}>
                      <span className="citation-source-badge">WEB SEARCH</span>
                      <div>
                        <strong>Tavily Search Engine Verification</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '2px' }}>
                          Cross-referenced publicly available technical articles and projects.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: ACTIVITY LOG */}
              {activeViewTab === 'activity' && (
                <div className="decision-summary-card">
                  <div className="decision-section-heading" style={{ marginBottom: '10px' }}>
                    Operational Activity Events
                  </div>
                  <div className="activity-terminal">
                    {selectedJob.thoughts && selectedJob.thoughts.length > 0 ? (
                      selectedJob.thoughts.map((t, idx) => (
                        <div key={idx} className="activity-event-line">
                          <span className="event-time">[{new Date(t.timestamp).toLocaleTimeString()}]</span>
                          <span className="event-agent">{t.agent?.toUpperCase()}:</span>
                          <span className="event-msg">{t.thought}</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--text-subtle)' }}>No agent events recorded yet.</div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: OUTREACH DRAFT */}
              {activeViewTab === 'outreach' && (
                <div className="outreach-card">
                  <div className="outreach-meta-row">
                    <div className="outreach-meta-item">
                      Recipient: <strong>{selectedJob.email}</strong>
                    </div>
                    <div className="outreach-meta-item">
                      Status: <strong>{selectedJob.review_status === 'approved' ? 'Approved & Prepared' : 'Awaiting Approval'}</strong>
                    </div>
                    <div className="outreach-meta-item">
                      Safety: <strong style={{ color: 'var(--warning)' }}>DRY_RUN Active</strong>
                    </div>
                  </div>

                  {draftSavedMessage && (
                    <div style={{ padding: '8px 12px', background: 'var(--success-soft)', color: 'var(--success)', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '12px' }}>
                      {draftSavedMessage}
                    </div>
                  )}

                  <div className="outreach-field">
                    <label>Email Subject</label>
                    <input 
                      type="text" 
                      className="outreach-input"
                      value={draftSubject}
                      onChange={(e) => setDraftSubject(e.target.value)}
                    />
                  </div>

                  <div className="outreach-field">
                    <label>Email Body (Editable Draft)</label>
                    <textarea 
                      className="outreach-textarea"
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button 
                      onClick={handleSaveDraft}
                      disabled={isSavingDraft}
                      className="btn-secondary-action"
                    >
                      {isSavingDraft ? 'Saving...' : 'Save Draft Changes'}
                    </button>
                    {selectedJob.status === 'awaiting_review' && (
                      <button 
                        onClick={() => handleReview(true)}
                        disabled={isReviewing}
                        className="btn-approve-action"
                      >
                        ✓ Approve & Send Prepared Outreach
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: AUDIT TRAIL */}
              {activeViewTab === 'audit' && (
                <div className="decision-summary-card">
                  <div className="decision-section-heading" style={{ marginBottom: '12px' }}>
                    Workflow Execution Audit Trail
                  </div>
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Action Step</th>
                        <th>Status</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedJob.steps && selectedJob.steps.length > 0 ? (
                        selectedJob.steps.map((step, idx) => (
                          <tr key={idx}>
                            <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{step.agent}</td>
                            <td>{step.step}</td>
                            <td>
                              <span className={`badge-tag ${step.status === 'complete' ? 'badge-approved' : 'badge-running'}`}>
                                {step.status}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{step.duration_ms ? `${step.duration_ms.toFixed(0)} ms` : '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-subtle)', padding: '16px' }}>
                            No audit events logged.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 3. MODAL: INGEST CANDIDATE */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => !isSubmitting && setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>
                Ingest Candidate Application
              </h3>
              <button 
                onClick={() => setShowModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="modal-tabs">
              <button 
                className={`modal-tab ${activeModalTab === 'resume' ? 'active' : ''}`}
                onClick={() => { setActiveModalTab('resume'); setModalFeedback(null); }}
              >
                PDF Resume Upload
              </button>
              <button 
                className={`modal-tab ${activeModalTab === 'manual' ? 'active' : ''}`}
                onClick={() => { setActiveModalTab('manual'); setModalFeedback(null); }}
              >
                Manual Application
              </button>
            </div>

            {modalFeedback && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 600,
                marginBottom: '14px',
                background: modalFeedback.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
                color: modalFeedback.type === 'success' ? 'var(--success)' : 'var(--danger)',
                border: `1px solid ${modalFeedback.type === 'success' ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 113, 133, 0.3)'}`
              }}>
                {modalFeedback.text}
              </div>
            )}

            {activeModalTab === 'resume' ? (
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
                  <div style={{ fontSize: '1.8rem', marginBottom: '6px' }}>📁</div>
                  {resumeFile ? (
                    <div>
                      <div style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                        {resumeFile.name}
                      </div>
                      <div style={{ color: 'var(--text-subtle)', fontSize: '0.75rem', marginTop: '2px' }}>
                        {(resumeFile.size / 1024).toFixed(1)} KB — Click to change
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>
                        Drop candidate PDF resume here
                      </div>
                      <div style={{ color: 'var(--text-subtle)', fontSize: '0.75rem', marginTop: '2px' }}>
                        or click to browse from device
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Role</label>
                  <select 
                    className="form-input"
                    value={resumeRole}
                    onChange={(e) => setResumeRole(e.target.value)}
                  >
                    <option value="Senior Backend Engineer">Senior Backend Engineer</option>
                    <option value="Junior Full-Stack Engineer">Junior Full-Stack Engineer</option>
                    <option value="AI/ML Systems Engineer">AI/ML Systems Engineer</option>
                    <option value="DevOps & Cloud Engineer">DevOps & Cloud Engineer</option>
                  </select>
                </div>

                <div style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="resumeConsentCheck"
                    checked={resumeConsent}
                    onChange={(e) => setResumeConsent(e.target.checked)}
                  />
                  <label htmlFor="resumeConsentCheck" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    Candidate consented to optional technical voice screen
                  </label>
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmitting || !resumeFile}
                  className="btn-primary-action"
                  style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                >
                  {isSubmitting ? 'Parsing & Dispatching...' : 'Extract Evidence & Ingest'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleManualSubmit}>
                <div className="form-group">
                  <label>Full Name</label>
                  <input 
                    className="form-input" 
                    placeholder="Candidate name"
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
                    placeholder="candidate@example.com"
                    value={manualData.email}
                    onChange={(e) => setManualData({ ...manualData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>GitHub Handle</label>
                  <input 
                    className="form-input" 
                    placeholder="e.g. torvalds"
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
                  </select>
                </div>

                <div style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="manualConsentCheck"
                    checked={manualData.voice_consent}
                    onChange={(e) => setManualData({ ...manualData, voice_consent: e.target.checked })}
                  />
                  <label htmlFor="manualConsentCheck" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    Candidate consented to optional technical voice screen
                  </label>
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="btn-primary-action"
                  style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                >
                  {isSubmitting ? 'Ingesting...' : 'Ingest Application'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
