import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import WorldTimeline from './WorldTimeline.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WorldTimeline />
  </StrictMode>,
)
