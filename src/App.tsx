import './App.css'
import logoGorseli from './assets/app_logo.png' // Dosya ismin neyse onu yaz
import mediaIcon from './assets/media_icon.jpeg'
import audioIcon from './assets/audio_icon.jpeg'
import textIcon from './assets/text_icon.jpeg'
import effectsIcon from './assets/effects_icon.jpeg'
import { useState } from 'react';

function App() {
  const [activeMenu, setActiveMenu] = useState('media');

  return (
    <div className="main-layout">
      <aside className="sidebar">
        <div className="logo-container">
          {/* Logo burada gözükecek */}
          <img src={logoGorseli} alt="Logo" className="app-icon" />
          <span className="logo-text">AETHER EDIT</span>
        </div>

        {/* Logonun altına ince bir çi<gi çekelim */}
        <div className="sidebar-divider"></div>

        {/* Menü Elemanları Ekleyelim */}
        <nav className="menu-grid">
        {/* Media Kartı */}
    <div 
        className={`menu-card ${activeMenu === 'media' ? 'active' : ''}`}
        onClick={() => setActiveMenu('media')}
      >
      <div className="icon-box">
  <img src={mediaIcon} alt="Media" className="menu-img-icon" />
</div>
      <span className="card-label">Media</span>
    </div>
    
    {/* Audio Kartı */}
    <div 
      className={`menu-card ${activeMenu === 'audio' ? 'active' : ''}`}
      onClick={() => setActiveMenu('audio')}
    >
      <div className="icon-box">
  <img src={audioIcon} alt="Audio" className="menu-img-icon" />
</div>
      <span className="card-label">Audio</span> 
    </div>

    {/* Text Kartı */}
    <div 
      className={`menu-card ${activeMenu === 'text' ? 'active' : ''}`}
      onClick={() => setActiveMenu('text')}
    >
      <div className="icon-box">
    <img src={textIcon} alt="Text" className="menu-img-icon" />
  </div>
    <span className="card-label">Text</span>
  </div>

    {/* Effects Kartı */}
    <div 
      className={`menu-card ${activeMenu === 'effects' ? 'active' : ''}`}
      onClick={() => setActiveMenu('effects')}
    >
      <div className="icon-box">
    <img src={effectsIcon} alt="Effects" className="menu-img-icon" />
  </div>
    <span className="card-label">Effects</span>
  </div>
</nav>
     <div className="sidebar-divider" style={{ marginTop: '15px', marginBottom: '15px' }}></div>


     <div className="sidebar-dynamic-content">
      {activeMenu === 'media' && (
        <div className="sidebar-drop-zone">
          <span className="sidebar-upload-icon">↑</span>
          <h4>Drop files here</h4>
          <p>Video, audio or image</p>
          <button className="sidebar-browse-btn">Browse Files</button>
        </div>
      )}

        {activeMenu === 'audio' && (
              <div className="sidebar-drop-zone">
                <span className="sidebar-upload-icon">🎵</span>
                <h4>Audio Library</h4>
                <p>Import music files</p>
                <button className="sidebar-browse-btn">Add Audio</button>
              </div>
            )}

            {activeMenu === 'text' && (
              <div className="sidebar-drop-zone">
                <span className="sidebar-upload-icon">📝</span>
                <h4>Text Library</h4>
                <p>Import text files</p>
                <button className="sidebar-browse-btn">Add Text</button>
              </div>
            )}
            
            {activeMenu === 'effects' && (
              <div className="sidebar-drop-zone">
                <span className="sidebar-upload-icon">✨</span>
                <h4>Effects Library</h4>
                <p>Browse and apply effects</p>
                <button className="sidebar-browse-btn">View Effects</button>
              </div>
            )}
            
              <div className="quick-tools-container">
      <div className="quick-tools-header">QUICK TOOLS</div>
    
      <div className="quick-tool-card">
        <div className="tool-icon-box">✂️</div>
        <div className="tool-info">
          <div className="tool-name">Split & Trim</div>
          <div className="tool-sub">Cut clips precisely</div>
        </div>
      </div>

      <div className="quick-tool-card">
        <div className="tool-icon-box">🔊</div>
        <div className="tool-info">
          <div className="tool-name">Adjust Volume</div>
          <div className="tool-sub">Balance audio levels</div>
        </div>
      </div>

      <div className="quick-tool-card">
        <div className="tool-icon-box">📐</div>
        <div className="tool-info">
          <div className="tool-name">Crop & Rotate</div>
          <div className="tool-sub">Resize and reframe</div>
        </div>
      </div>

      <div className="quick-tool-card">
        <div className="tool-icon-box">✨</div>
        <div className="tool-info">
          <div className="tool-name">Auto Enhance</div>
          <div className="tool-sub">One-click improvement</div>
        </div>
      </div>
     </div>
     </div>
      </aside>

      <main className="content">
        {/* Ana içerik alanı */}  
      </main>
    </div>
  )
}

export default App