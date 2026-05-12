import './QuickTools.css';

export default function QuickTools() {
  const tools = [
    { icon: '✂️', name: 'Split & Trim', sub: 'Cut clips precisely' },
    { icon: '🔊', name: 'Adjust Volume', sub: 'Balance audio levels' },
    { icon: '📐', name: 'Crop & Rotate', sub: 'Resize and reframe' },
    { icon: '✨', name: 'Auto Enhance', sub: 'One-click improvement' }
  ];

  return (
    <div className="quick-tools-container">
      <div className="quick-tools-header">QUICK TOOLS</div>
      {tools.map((tool, index) => (
        <div className="quick-tool-card" key={index}>
          <div className="tool-icon-box">{tool.icon}</div>
          <div className="tool-info">
            <div className="tool-name">{tool.name}</div>
            <div className="tool-sub">{tool.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}