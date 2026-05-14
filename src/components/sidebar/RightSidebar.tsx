import { useState } from 'react';
import './RightSidebar.css';

type TabType = 'style' | 'motion' | 'export';

const RightSidebar = () => {
  const [activeTab, setActiveTab] = useState<TabType>('style');
  const [opacity, setOpacity] = useState(100);
  const [blur, setBlur] = useState(0);

  return (
    <aside className="right-sidebar">
      {/* Header */}
      <div className="rs-header">
        <span className="rs-header-title">Properties</span>
      </div>

      {/* Tabs */}
      <div className="rs-tabs">
        {(['style', 'motion', 'export'] as TabType[]).map((tab) => (
          <button
            key={tab}
            className={`rs-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Style Tab */}
      {activeTab === 'style' && (
        <div className="rs-content">

          {/* Transform */}
          <div className="rs-section">
            <div className="rs-section-title">Transform</div>
            <div className="rs-row">
              <span className="rs-label">X</span>
              <input className="rs-input accent" defaultValue="240" />
              <span className="rs-unit">px</span>
            </div>
            <div className="rs-row">
              <span className="rs-label">Y</span>
              <input className="rs-input accent" defaultValue="180" />
              <span className="rs-unit">px</span>
            </div>
            <div className="rs-row-pair">
              <div className="rs-row">
                <span className="rs-label">W</span>
                <input className="rs-input" defaultValue="1920" />
              </div>
              <div className="rs-row">
                <span className="rs-label">H</span>
                <input className="rs-input" defaultValue="1080" />
              </div>
            </div>
            <div className="rs-row">
              <span className="rs-label">Rotate</span>
              <input className="rs-input" defaultValue="0" />
              <span className="rs-unit">°</span>
            </div>
          </div>

          {/* Appearance */}
          <div className="rs-section">
            <div className="rs-section-title">Appearance</div>
            <div className="rs-color-row">
              <input type="color" className="rs-color-swatch" defaultValue="#a78bfa" />
              <span className="rs-hex">#A78BFA</span>
              <span className="rs-opacity-label">{opacity}%</span>
            </div>

            <div className="rs-slider-group">
              <div className="rs-slider-header">
                <span className="rs-label">Opacity</span>
                <span className="rs-value-badge">{opacity}%</span>
              </div>
              <input
                type="range" min="0" max="100" step="1"
                value={opacity}
                className="rs-slider"
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </div>

            <div className="rs-slider-group">
              <div className="rs-slider-header">
                <span className="rs-label">Blur</span>
                <span className="rs-value-badge">{blur}px</span>
              </div>
              <input
                type="range" min="0" max="40" step="1"
                value={blur}
                className="rs-slider"
                onChange={(e) => setBlur(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Clip */}
          <div className="rs-section">
            <div className="rs-section-title">Clip</div>
            <div className="rs-row">
              <span className="rs-label">Duration</span>
              <span className="rs-badge">00:04:30</span>
            </div>
            <div className="rs-row">
              <span className="rs-label">Speed</span>
              <span className="rs-badge accent">1.0×</span>
            </div>
          </div>

        </div>
      )}

      {/* Motion Tab */}
      {activeTab === 'motion' && (
        <div className="rs-content">
          <div className="rs-section">
            <div className="rs-section-title">Keyframes</div>
            {[
              { label: 'Position', time: '00:02:14', active: true },
              { label: 'Opacity', time: '—', active: false },
              { label: 'Scale', time: '00:02:14', active: true },
              { label: 'Rotation', time: '—', active: false },
            ].map((kf) => (
              <div key={kf.label} className="rs-keyframe-row">
                <div className={`rs-kf-dot ${kf.active ? 'active' : ''}`} />
                <span className="rs-label">{kf.label}</span>
                <span className="rs-kf-time">{kf.time}</span>
              </div>
            ))}
          </div>

          <div className="rs-section">
            <div className="rs-section-title">Easing</div>
            {['Linear', 'Ease In', 'Ease Out', 'Ease In Out'].map((ease) => (
              <button key={ease} className={`rs-ease-btn ${ease === 'Ease Out' ? 'active' : ''}`}>
                {ease}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Export Tab */}
      {activeTab === 'export' && (
        <div className="rs-content">
          <div className="rs-section">
            <div className="rs-section-title">Format</div>
            {['MP4 · H.264', 'MOV · ProRes', 'WebM · VP9', 'GIF'].map((fmt) => (
              <div key={fmt} className={`rs-format-row ${fmt === 'MP4 · H.264' ? 'active' : ''}`}>
                <div className="rs-format-dot" />
                <span className="rs-label">{fmt}</span>
              </div>
            ))}
          </div>
          <div className="rs-section">
            <div className="rs-section-title">Resolution</div>
            <div className="rs-row">
              <span className="rs-label">Preset</span>
              <span className="rs-badge accent">4K Ultra</span>
            </div>
            <div className="rs-row">
              <span className="rs-label">FPS</span>
              <input className="rs-input" defaultValue="60" />
            </div>
          </div>
        </div>
      )}

      {/* Footer Buttons */}
      <div className="rs-footer">
        <button className="rs-btn-secondary">Reset</button>
        <button className="rs-btn-primary">Apply</button>
      </div>
    </aside>
  );
};

export default RightSidebar;
