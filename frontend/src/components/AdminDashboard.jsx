import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase'; 

// ✅ FIXED: Moved outside the main component so it doesn't get destroyed on every render!
const DashboardCard = ({ title, count, suffix, onClick, loading }) => (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: '15px 20px', 
    backgroundColor: 'white', 
    border: '1px solid #e0e0e0', 
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
  }}>
    <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#2c3e50' }}>
      {title}
    </span>
    
    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
      <span style={{ 
        backgroundColor: '#f1f2f6', 
        padding: '4px 10px', 
        borderRadius: '12px', 
        fontSize: '0.9rem', 
        color: '#7f8c8d',
        fontWeight: '500'
      }}>
        {loading ? '...' : `${count} ${suffix}`}
      </span>
      <button 
        onClick={onClick}
        style={{ padding: '8px 16px', fontSize: '0.9rem' }}
      >
        Manage
      </button>
    </div>
  </div>
);

function AdminDashboard() {
  const navigate = useNavigate();
  
  const [stats, setStats] = useState({
    groups: 0,
    volunteers: 0,
    guides: 0,
    events: 0,
    reports: 0
  });
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        setLoading(true);

        const groupsSnap = await getCountFromServer(collection(db, 'groups'));
        
        const guidesQuery = query(collection(db, 'users'), where('role', '==', 'guide'));
        const guidesSnap = await getCountFromServer(guidesQuery);

       
       const volunteersSnap = await getCountFromServer(collection(db, 'volunteers'));

        const eventsSnap = await getCountFromServer(collection(db, 'events'));
        const reportsSnap = await getCountFromServer(collection(db, 'reports'));

        setStats({
          groups: groupsSnap.data().count,
          guides: guidesSnap.data().count,
          volunteers: volunteersSnap.data().count,
          events: eventsSnap.data().count,
          reports: reportsSnap.data().count
        });

      } catch (error) {
        console.error("Error fetching dashboard statistics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardStats();
  }, []);

  return (
    <div>
      <h3 style={{ color: '#2c3e50', marginBottom: '20px' }}>Admin Control Center</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '500px' }}>
        <DashboardCard 
          title="Groups Management" 
          count={stats.groups} 
          suffix="Active" 
          loading={loading}
          onClick={() => navigate('/admin/groups')} 
        />
        <DashboardCard 
          title="Volunteers Management" 
          count={stats.volunteers} 
          suffix="Registered" 
          loading={loading}
          onClick={() => navigate('/admin/volunteers')} 
        />
        <DashboardCard 
          title="Guides Management" 
          count={stats.guides} 
          suffix="Assigned" 
          loading={loading}
          onClick={() => navigate('/admin/guides')} 
        />
        <DashboardCard 
          title="Events Management" 
          count={stats.events} 
          suffix="Scheduled" 
          loading={loading}
          onClick={() => navigate('/admin/events')} 
        />
        <DashboardCard 
          title="System Reports" 
          count={stats.reports} 
          suffix="Generated" 
          loading={loading}
          onClick={() => navigate('/admin/reports')} 
        />
      </div>
    </div>
  );
}

export default AdminDashboard;