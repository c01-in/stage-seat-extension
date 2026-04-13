import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { StageSeatApp } from './StageSeatApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StageSeatApp />
  </StrictMode>,
)
