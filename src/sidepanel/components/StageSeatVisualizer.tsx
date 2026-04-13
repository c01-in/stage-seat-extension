import { useEffect, useRef } from 'react'
import type { ArenaPreset, ListenerPosition } from '../../shared/types'

interface StageSeatVisualizerProps {
  arena: ArenaPreset
  listenerPosition: ListenerPosition
  level: number
  active: boolean
}

export function StageSeatVisualizer({
  arena,
  listenerPosition,
  level,
  active,
}: StageSeatVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const levelRef = useRef(level)
  const listenerRef = useRef(listenerPosition)
  const activeRef = useRef(active)

  useEffect(() => {
    levelRef.current = level
    listenerRef.current = listenerPosition
    activeRef.current = active
  }, [level, listenerPosition, active])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    let rafId = 0
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const render = (time: number) => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      const stageCenterX = (arena.stageRect.x + arena.stageRect.width / 2) * width
      const stageCenterY = (arena.stageRect.y + arena.stageRect.height / 2) * height
      const listenerX = listenerRef.current.x * width
      const listenerY = listenerRef.current.y * height
      const meter = levelRef.current
      const hasSignal = meter > 0.035
      const pulseActive = activeRef.current && hasSignal

      context.clearRect(0, 0, width, height)

      const glow = context.createRadialGradient(listenerX, listenerY, 12, listenerX, listenerY, 140)
      glow.addColorStop(0, `rgba(255, 188, 87, ${0.26 + meter * 0.25})`)
      glow.addColorStop(1, 'rgba(255, 188, 87, 0)')
      context.fillStyle = glow
      context.fillRect(0, 0, width, height)

      const beam = context.createLinearGradient(stageCenterX, stageCenterY, listenerX, listenerY)
      beam.addColorStop(0, `rgba(80, 224, 255, ${0.22 + meter * 0.18})`)
      beam.addColorStop(1, 'rgba(80, 224, 255, 0)')
      context.strokeStyle = beam
      context.lineWidth = 2 + meter * 3
      context.beginPath()
      context.moveTo(stageCenterX, stageCenterY)
      context.lineTo(listenerX, listenerY)
      context.stroke()

      const activePulseSpeed = 0.6 + meter * 0.8
      const idlePulseSpeed = 0.06
      const pulseSpeed = pulseActive ? activePulseSpeed : idlePulseSpeed
      const activeRadiusBase = 28
      const idleRadiusBase = 14
      const radiusBase = pulseActive ? activeRadiusBase : idleRadiusBase
      const activeRadiusRange = 110 + meter * 64
      const idleRadiusRange = 72
      const radiusRange = pulseActive ? activeRadiusRange : idleRadiusRange
      for (let index = 0; index < 4; index += 1) {
        const phase = ((time / 1000) * pulseSpeed + index / 4) % 1
        const radius = radiusBase + phase * radiusRange
        const alpha = (1 - phase) * (pulseActive ? 0.18 + meter * 0.22 : 0.08)
        context.strokeStyle = `rgba(109, 243, 255, ${alpha})`
        context.lineWidth = index === 0 ? 2.5 : 1.25
        context.beginPath()
        context.arc(stageCenterX, stageCenterY, radius, 0, Math.PI * 2)
        context.stroke()
      }

      context.fillStyle = `rgba(255, 232, 179, ${0.5 + meter * 0.35})`
      context.beginPath()
      context.arc(listenerX, listenerY, 10 + meter * 7, 0, Math.PI * 2)
      context.fill()

      rafId = window.requestAnimationFrame(render)
    }

    rafId = window.requestAnimationFrame(render)
    window.addEventListener('resize', resize)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [arena])

  return <canvas ref={canvasRef} className="arena-visualizer" aria-hidden="true" />
}
