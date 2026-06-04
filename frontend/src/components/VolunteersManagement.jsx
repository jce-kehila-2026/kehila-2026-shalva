import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import './VolunteersManagement.css';

const VolunteersManagement = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const passedGroup = location.state?.group || null;

  const [volunteers, setVolunteers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isAdding, setIsAdding] = useState(false);
  const [editingVolunteerId, setEditingVolunteerId] = useState(null);
  
  const initialFormData = {
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    age: '',
    school: '',
    experience: '',
    idNumber: '',
    groupId: passedGroup ? passedGroup.id : ''
  };
  
  const [formData, setFormData] = useState(initialFormData);

  const fetchData = async () => {
    try {
      const volSnap = await getDocs(collection(db, 'volunteers'));
      const volData = volSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVolunteers(volData);

      const groupsSnap = await getDocs(collection(db, 'groups'));
      const groupsData = groupsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGroups(groupsData);
    } catch (error) {
      console.error("שגיאה בשליפת נתונים:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getGroupName = (groupId) => {
    if (!groupId) return 'ללא קבוצה';
    const group = groups.find(g => g.id === groupId);
    return group ? group.groupName : 'קבוצה לא ידועה';
  };

  const filteredAndSortedVolunteers = volunteers
    .filter(vol => {
      const fullName = `${vol.firstName || ''} ${vol.lastName || ''}`.toLowerCase();
      return fullName.includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      const groupNameA = getGroupName(a.groupId);
      const groupNameB = getGroupName(b.groupId);
      return groupNameA.localeCompare(groupNameB, 'he'); 
    });


  const handleOpenAdd = () => {
    setEditingVolunteerId(null);
    setFormData(initialFormData);
    setIsAdding(!isAdding); 
  };

  const handleOpenEdit = (volunteer) => {
    setIsAdding(false);
    
    if (editingVolunteerId === volunteer.id) {
      setEditingVolunteerId(null);
      return;
    }

    setEditingVolunteerId(volunteer.id);
    setFormData({
      firstName: volunteer.firstName || '',
      lastName: volunteer.lastName || '',
      phone: volunteer.phone || '',
      email: volunteer.email || '',
      address: volunteer.address || '',
      age: volunteer.age || '',
      school: volunteer.school || '',
      experience: volunteer.experience || '',
      idNumber: volunteer.idNumber || '',
      groupId: volunteer.groupId || ''
    });
  };

  const handleCloseForm = () => {
    setIsAdding(false);
    setEditingVolunteerId(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      alert("חובה להזין שם פרטי ושם משפחה");
      return;
    }

    try {
      // --- התיקון שלנו: מוצאים את שם הקבוצה ושומרים אותו במסד הנתונים ---
      const selectedGroup = groups.find(g => g.id === formData.groupId);
      const dataToSave = {
        ...formData,
        groupName: selectedGroup ? selectedGroup.groupName : ''
      };

      if (editingVolunteerId) {
        const volRef = doc(db, 'volunteers', editingVolunteerId);
        await updateDoc(volRef, dataToSave);
      } else {
        await addDoc(collection(db, 'volunteers'), dataToSave);
      }
      handleCloseForm();
      fetchData(); 
    } catch (error) {
      console.error("שגיאה בשמירת מתנדב:", error);
    }
  };

  const handleDelete = async (volunteerId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק מתנדב זה?")) return;
    try {
      await deleteDoc(doc(db, 'volunteers', volunteerId));
      fetchData();
    } catch (error) {
      console.error("שגיאה במחיקת מתנדב:", error);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const renderForm = (isEditMode) => (
    <div style={{ backgroundColor: '#f0f9ff', padding: '20px', borderRadius: '8px', border: '1px solid #bae6fd', width: '100%', boxSizing: 'border-box' }}>
      <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#0369a1' }}>
        {isEditMode ? 'עריכת מתנדב' : 'הוספת מתנדב חדש'}
      </h3>
      <form onSubmit={handleSave} className="volunteer-form">
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>שם פרטי: *</label>
            <input type="text" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="firstName" value={formData.firstName} onChange={handleInputChange} required />
          </div>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>שם משפחה: *</label>
            <input type="text" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="lastName" value={formData.lastName} onChange={handleInputChange} required />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>תעודת זהות:</label>
            <input type="text" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="idNumber" value={formData.idNumber} onChange={handleInputChange} />
          </div>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>גיל:</label>
            <input type="text" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="age" value={formData.age} onChange={handleInputChange} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>טלפון:</label>
            <input type="tel" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="phone" value={formData.phone} onChange={handleInputChange} dir="ltr" />
          </div>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>אימייל:</label>
            <input type="email" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="email" value={formData.email} onChange={handleInputChange} dir="ltr" />
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>כתובת:</label>
          <input type="text" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="address" value={formData.address} onChange={handleInputChange} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>בית ספר:</label>
            <input type="text" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="school" value={formData.school} onChange={handleInputChange} />
          </div>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '5px' }}>ניסיון:</label>
            <input type="text" className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="experience" value={formData.experience} onChange={handleInputChange} />
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>שיוך לקבוצה:</label>
          <select className="styled-input" style={{ width: '100%', boxSizing: 'border-box' }} name="groupId" value={formData.groupId} onChange={handleInputChange}>
            <option value="">-- ללא קבוצה --</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.groupName}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="submit" className="btn btn-success">
            {isEditMode ? 'שמור שינויים' : 'הוסף מתנדב'}
          </button>
          <button type="button" className="btn btn-outline" onClick={handleCloseForm}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="admin-container">
      <header className="page-header">
        <div>
          <h2 className="admin-title" style={{ borderBottom: 'none', marginBottom: '5px' }}>ניהול מתנדבים</h2>
          {passedGroup && (
            <p className="subtitle">מסונן עבור קבוצה: <strong>{passedGroup.groupName}</strong></p>
          )}
        </div>
        <button className="btn btn-outline" onClick={() => navigate(-1)}>
          חזור לקבוצות
        </button>
      </header>

      <div className="action-bar" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '15px' }}>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleOpenAdd}>
            {isAdding ? 'סגור טופס' : '+ הוסף מתנדב חדש'}
          </button>
          <input 
            type="text" 
            className="styled-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 חפש מתנדב לפי שם..."
            style={{ width: '300px' }}
          />
        </div>

        {isAdding && (
          <div style={{ width: '100%', marginTop: '10px' }}>
            {renderForm(false)}
          </div>
        )}
      </div>

      <div className="table-container">
        <table className="styled-table">
          <thead>
            <tr>
              <th>שם המתנדב</th>
              <th>שיוך לקבוצה</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedVolunteers.length > 0 ? (
              filteredAndSortedVolunteers.map((vol) => (
                <React.Fragment key={vol.id}>
                  <tr>
                    <td><strong>{`${vol.firstName || ''} ${vol.lastName || ''}`}</strong></td>
                    <td>{getGroupName(vol.groupId)}</td>
                    <td className="actions-cell">
                      <button className="btn btn-primary" onClick={() => {
                        // --- התיקון השני: מוודאים ששם הקבוצה עובר איתנו למסך הפרטים ---
                        const volForDetails = {
                          ...vol,
                          groupName: getGroupName(vol.groupId)
                        };
                        navigate(`/volunteer-details/${vol.id}`, { state: { volunteer: volForDetails } });
                      }}>
                        פרטים
                      </button>
                      <button className="btn btn-outline" onClick={() => handleOpenEdit(vol)}>
                        {editingVolunteerId === vol.id ? 'סגור עריכה' : 'ערוך / שייך'}
                      </button>
                      <button 
                        className="btn btn-outline" 
                        style={{ borderColor: '#ef4444', color: '#ef4444' }}
                        onClick={() => handleDelete(vol.id)}
                      >
                        מחק
                      </button>
                    </td>
                  </tr>

                  {editingVolunteerId === vol.id && (
                    <tr>
                      <td colSpan="3" style={{ padding: '0 20px 20px 20px', backgroundColor: '#f8fafc' }}>
                        {renderForm(true)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            ) : (
              <tr>
                <td colSpan="3" style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                  לא נמצאו מתנדבים.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VolunteersManagement;