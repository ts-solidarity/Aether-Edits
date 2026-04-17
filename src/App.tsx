import { useState } from 'react' // React'ın hafızasını (state) kullanmak için
import './App.css'

function App() {
  // Seçilen videonun adresini hafızada tutmak için bir "state" oluşturuyoruz
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; // Seçilen ilk dosyayı al
    if (file) {
      // Dosyayı tarayıcının oynatabileceği bir URL'ye çevir
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo">AetherEdit</div>
        <div className="menu-items">
          {/* Gizli bir dosya seçme inputu oluşturuyoruz */}
          <label className="upload-btn">
            📁 Video Yükle
            <input type="file" accept="video/*" onChange={handleFileChange} hidden />
          </label>
          <button className="menu-btn">✨ AI Araçları</button>
        </div>
      </aside>

      <main className="content-area">
        <div className="preview-window">
          {videoSrc ? (
            // Eğer bir video seçildiyse gerçek video oynatıcıyı göster
            <video src={videoSrc} controls className="main-video" />
          ) : (
            // Video seçilmediyse bu yazıyı göster
            <div className="placeholder-box">Lütfen bir video yükleyin...</div>
          )}
        </div>
        <div className="timeline-area">
          <div className="placeholder-box">Zaman Çizelgesi (Timeline)</div>
        </div>
      </main>
    </div>
  )
}

export default App
