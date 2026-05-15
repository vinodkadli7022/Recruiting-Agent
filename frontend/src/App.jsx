// frontend/src/App.jsx
import { useState, useEffect, useRef } from "react"

const API = "http://localhost:8000"
const WS = "ws://localhost:8000/ws"

const DECISION_COLORS = {
  STRONG_YES: "#22c55e",
  SOFT_YES: "#f59e0b",
  NO: "#ef4444"
}

export default function App() {
  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [steps, setSteps] = useState({})
  const wsRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/jobs/`).then(r => r.json()).then(setJobs).catch(err => console.error("Fetch failed:", err))
    
    const connectWS = () => {
      wsRef.current = new WebSocket(WS)
      
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data)
        
        if (data.type === "job_received") {
          setJobs(prev => [{
            job_id: data.job_id,
            name: data.name,
            role: data.role,
            status: "received"
          }, ...prev])
        }
        
        if (data.type === "status_update") {
          setJobs(prev => prev.map(j => 
            j.job_id === data.job_id ? {...j, status: data.status} : j
          ))
        }
        
        if (data.type === "agent_step") {
          setSteps(prev => ({
            ...prev,
            [data.job_id]: [...(prev[data.job_id] || []), data]
          }))
        }
        
        if (data.type === "job_complete") {
          setJobs(prev => prev.map(j =>
            j.job_id === data.job_id ? {...j, status: "complete", decision: data.decision} : j
          ))
        }
      }

      wsRef.current.onclose = () => {
        setTimeout(connectWS, 2000)
      }
    }

    connectWS()
    
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (selectedJob && selectedJob.job_id) {
      fetch(`${API}/jobs/${selectedJob.job_id}`)
        .then(r => r.json())
        .then(data => {
          setSteps(prev => ({...prev, [data.job_id]: data.steps}))
        })
    }
  }, [selectedJob?.job_id])

  return (
    <div style={{display: "flex", height: "100vh", fontFamily: "monospace", background: "#0a0a0a", color: "#e5e5e5", overflow: "hidden"}}>
      <div style={{width: 360, borderRight: "1px solid #222", overflowY: "auto"}}>
        <div style={{padding: "16px", borderBottom: "1px solid #222", fontSize: 12, color: "#666", fontWeight: "bold", letterSpacing: "1px"}}>
          PIPELINE — {jobs.length} CANDIDATES
        </div>
        {jobs.map(job => (
          <div
            key={job.job_id}
            onClick={() => setSelectedJob(job)}
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid #111",
              cursor: "pointer",
              background: selectedJob?.job_id === job.job_id ? "#111" : "transparent"
            }}
          >
            <div style={{fontSize: 14, fontWeight: 600}}>{job.name || "Candidate"}</div>
            <div style={{fontSize: 11, color: "#666", marginTop: 2}}>{job.role || job.role_applied}</div>
            <div style={{display: "flex", alignItems: "center", gap: 8, marginTop: 6}}>
              <StatusBadge status={job.status} />
              {job.decision && (
                <span style={{
                  fontSize: 10,
                  color: DECISION_COLORS[job.decision],
                  fontWeight: 700
                }}>{job.decision}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      
      <div style={{flex: 1, overflowY: "auto", padding: 24, background: "#050505"}}>
        {selectedJob ? (
          <JobDetail job={selectedJob} steps={steps[selectedJob.job_id] || []} />
        ) : (
          <div style={{color: "#444", marginTop: 80, textAlign: "center"}}>
            Select a candidate to view pipeline
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = {
    received: "#3b82f6",
    researching: "#8b5cf6",
    reasoning: "#f59e0b",
    acting: "#f97316",
    complete: "#22c55e",
    failed: "#ef4444"
  }
  return (
    <span style={{
      fontSize: 9,
      padding: "2px 6px",
      borderRadius: 3,
      background: (colors[status] || "#666") + "22",
      color: colors[status] || "#666",
      fontWeight: 700,
      letterSpacing: 1
    }}>
      {(status || "unknown").toUpperCase()}
    </span>
  )
}

function JobDetail({ job, steps }) {
  return (
    <div style={{maxWidth: 800}}>
      <h2 style={{margin: 0, fontSize: 24, color: "#fff"}}>{job.name}</h2>
      <div style={{color: "#666", fontSize: 12, marginTop: 4}}>{job.role || job.role_applied} · {job.job_id}</div>
      
      <div style={{marginTop: 40}}>
        <div style={{fontSize: 11, color: "#444", marginBottom: 20, letterSpacing: 2, fontWeight: "bold"}}>AGENT TIMELINE</div>
        <div style={{position: "relative", paddingLeft: 20, borderLeft: "1px solid #222"}}>
          {steps.map((step, i) => (
            <div key={i} style={{display: "flex", gap: 16, marginBottom: 16, fontSize: 13}}>
              <div style={{color: "#888", fontWeight: "bold", width: 120}}>{(step.agent || "").toUpperCase()}</div>
              <div style={{flex: 1}}>
                <div style={{color: "#ccc"}}>{step.step}</div>
                {step.output_data && step.status === "complete" && (
                  <pre style={{background: "#111", padding: 8, borderRadius: 4, fontSize: 10, color: "#666", marginTop: 8}}>
                    {JSON.stringify(step.output_data, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
