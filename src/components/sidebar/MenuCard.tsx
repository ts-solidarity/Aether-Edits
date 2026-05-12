import './MenuCard.css';

interface MenuCardProps {
  id: string;
  activeMenu: string;
  setActiveMenu: (id: string) => void;
  icon: string;
  label: string;
}

export default function MenuCard({ id, activeMenu, setActiveMenu, icon, label }: MenuCardProps) {
  return (
    <div 
      className={`menu-card ${activeMenu === id ? 'active' : ''}`}
      onClick={() => setActiveMenu(id)}
    >
      <div className="icon-box">
        <img src={icon} alt={label} className="menu-img-icon" />
      </div>
      <span className="card-label">{label}</span>
    </div>
  );
}