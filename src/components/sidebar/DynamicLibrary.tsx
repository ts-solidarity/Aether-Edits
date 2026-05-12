import './DynamicLibrary.css';

interface DynamicLibraryProps {
  activeMenu: string;
}

export default function DynamicLibrary({ activeMenu }: DynamicLibraryProps) {
  switch (activeMenu) {
    case 'media':
      return (
        <div className="sidebar-drop-zone">
          <span className="sidebar-upload-icon">↑</span>
          <h4>Drop files here</h4>
          <p>Video, audio or image</p>
          <button className="sidebar-browse-btn">Browse Files</button>
        </div>
      );
    case 'audio':
      return (
        <div className="sidebar-drop-zone">
          <span className="sidebar-upload-icon">🎵</span>
          <h4>Audio Library</h4>
          <p>Import music files</p>
          <button className="sidebar-browse-btn">Add Audio</button>
        </div>
      );
    case 'text':
      return (
        <div className="sidebar-drop-zone">
          <span className="sidebar-upload-icon">📝</span>
          <h4>Text Library</h4>
          <p>Import text files</p>
          <button className="sidebar-browse-btn">Add Text</button>
        </div>
      );
    case 'effects':
      return (
        <div className="sidebar-drop-zone">
          <span className="sidebar-upload-icon">✨</span>
          <h4>Effects Library</h4>
          <p>Browse and apply effects</p>
          <button className="sidebar-browse-btn">View Effects</button>
        </div>
      );
    default:
      return null;
  }
}