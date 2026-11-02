/** Liquid-glass material layers sit behind existing accessible controls. */
import React, { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import LiquidGlass from 'liquid-glass-react'

function Material({ target, dark }) {
  const [size, setSize] = useState({ width: 1, height: 1 })
  useLayoutEffect(() => {
    const measure = () => setSize({ width: target.clientWidth, height: target.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [target])
  return <LiquidGlass
    displacementScale={26}
    blurAmount={0.12}
    saturation={100}
    aberrationIntensity={0.35}
    elasticity={0}
    cornerRadius={target.classList.contains('welcome-symbol') ? 25 : 20}
    padding="0px"
    overLight={!dark}
    mode="standard"
    style={{ position: 'absolute', top: '50%', left: '50%' }}
  ><div style={{ width: size.width, height: size.height }} /></LiquidGlass>
}

const roots = new Map()
let frame
function updateMaterials() {
  const enabled = document.documentElement.dataset.appearance === 'liquid'
  const dark = document.documentElement.dataset.glassTone === 'dark'
  for (const [target, entry] of roots) {
    const { root, host } = entry
    if (!target.isConnected || !enabled) { root.unmount(); host.remove(); target.classList.remove('liquid-material'); roots.delete(target) }
    else if (entry.dark !== dark) { entry.dark = dark; root.render(<Material target={target} dark={dark} />) }
  }
  if (!enabled) return
  for (const target of document.querySelectorAll('.composer, .review-card, .home-mark, .folder-shape')) {
    if (roots.has(target)) continue
    const host = document.createElement('div')
    host.className = 'glass-layer'
    host.setAttribute('aria-hidden', 'true')
    target.classList.add('liquid-material')
    target.prepend(host)
    const root = createRoot(host)
    roots.set(target, { root, host, dark })
    root.render(<Material target={target} dark={dark} />)
  }
}
const observer = new MutationObserver(() => {
  if (frame) return
  frame = requestAnimationFrame(() => { frame = undefined; updateMaterials() })
})
observer.observe(document.querySelector('.workspace'), { childList: true, subtree: true })
new MutationObserver(updateMaterials).observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance', 'data-glass-tone'] })
updateMaterials()
document.documentElement.dataset.glassLibrary = 'liquid-glass-react'
