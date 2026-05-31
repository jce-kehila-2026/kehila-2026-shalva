import { useNavigate } from 'react-router-dom';

function AdminDashboard() {
  const navigate = useNavigate();

  return (
    <div>
      <h3>Admin Control Center</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '300px', margin: '20px 0' }}>
        <button onClick={() => navigate('/admin/groups')}>Groups Management</button>
        <button onClick={() => navigate('/admin/volunteers')}>Volunteers Management</button>
        <button onClick={() => navigate('/admin/guides')}>Guides Management</button>
        <button onClick={() => navigate('/admin/events')}>Events Management</button>
        <button onClick={() => navigate('/admin/reports')}>Reports</button>
      </div>
    </div>
  );
}

export default AdminDashboard;