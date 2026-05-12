import { useState } from 'react';
import './App.css';

import logoGorseli from './assets/app_logo.png';
import mediaIcon from './assets/media_icon.jpeg';
import audioIcon from './assets/audio_icon.jpeg';
import textIcon from './assets/text_icon.jpeg';
import effectsIcon from './assets/effects_icon.jpeg';

import MenuCard from './components/sidebar/MenuCard';
import DynamicLibrary from './components/sidebar/DynamicLibrary';
import QuickTools from './components/sidebar/QuickTools';

function App() {
  const [activeMenu, setActiveMenu] = useState('media');

  const menuItems = [
    { id: 'media', label: 'Media', icon: mediaIcon },
    { id: 'audio', label: 'Audio', icon: audioIcon },
    { id: 'text', label: 'Text', icon: textIcon },
    { id: 'effects', label: 'Effects', icon: effectsIcon },
  ];

  return (
    <div className="main-layout">
      <aside className="sidebar">
        
        {/* Logo Bölümü */}
        <div className="logo-container">
        
          <img src={logoGorseli} alt="Logo" className="app-icon" />
        
          <span className="logo-text">AETHER EDIT</span>
        </div>
        
        <div className="sidebar-divider"></div>

        {/* Menü Kartları Grid Yapısı */}
        <nav className="menu-grid">
          {menuItems.map((item) => (
            <MenuCard
              key={item.id}
              id={item.id}
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              icon={item.icon}
              label={item.label}
            />
          ))}
        </nav>
        
        <div className="sidebar-divider" style={{ marginTop: '15px', marginBottom: '15px' }} />

        {/* Dinamik İçerik ve Hızlı Araçlar */}
        <div className="sidebar-dynamic-content">
          <DynamicLibrary activeMenu={activeMenu} />
          <QuickTools />
        </div>

      </aside>

      {/* Ana Önizleme ve Timeline Alanı (İleride doldurulacak) */}
      <main className="content">
        {}
      </main>
    </div>
  );
}

export default App;