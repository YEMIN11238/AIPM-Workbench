/** Render Mermaid from local documents with strict security and bounded diagram size. */
import mermaid from 'mermaid'
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', suppressErrorRendering: true, maxTextSize: 30000, flowchart: { htmlLabels: false } })
let serial = 0
/** Enhance Mermaid code blocks; invalid diagrams remain readable source. */
export async function renderDiagrams(container) {
  for (const code of container.querySelectorAll('code.language-mermaid')) {
    if (code.textContent.length > 30000) continue
    try {
      const { svg } = await mermaid.render('blueprint-diagram-' + ++serial, code.textContent)
      if (!container.isConnected) return
      const image = container.ownerDocument.createElement('img'); image.alt = '架构流程图'; image.className = 'bpf-image'; image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
      const details = container.ownerDocument.createElement('details'), summary = container.ownerDocument.createElement('summary'); summary.textContent = '查看图表源码'; details.append(summary, code.parentElement.cloneNode(true))
      code.parentElement.replaceWith(image, details)
    } catch (error) { code.parentElement.title = '图表未能渲染，保留原始源码' }
  }
}
