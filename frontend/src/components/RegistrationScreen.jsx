import React, { useState } from "react";
import { db } from "../firebase";
import { collection, addDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./RegistrationScreen.css";

function RegistrationScreen() {
  const navigate = useNavigate();
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    status: "ממתין לאישור",
    age: "",
    birthDate: "",
    experience: "",
    address: "",
    school: "",
    signatureName: "", // Text signature fallback
  });
  
  const [signatureFile, setSignatureFile] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      // In a real application, we would upload this file to Firebase Storage.
      // For this implementation, we can store the file name or a base64 representation.
      const file = e.target.files[0];
      setSignatureFile(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // Create record
      const registrantData = {
        ...formData,
        age: Number(formData.age),
        createdAt: new Date(),
        signatureFileName: signatureFile ? signatureFile.name : "None",
      };

      await addDoc(collection(db, "registrants"), registrantData);

      setIsSuccess(true);

      // Reset form
      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        status: "ממתין לאישור",
        age: "",
        birthDate: "",
        experience: "",
        address: "",
        school: "",
        signatureName: "",
      });
      setSignatureFile(null);
    } catch (error) {
      console.error("Error saving registration:", error);
      alert("אירעה שגיאה בשליחת ההרשמה");
    }
  };

  if (isSuccess) {
    return (
      <div className="registration-page" dir="rtl">
        <div className="registration-card" style={{ textAlign: "center", padding: "40px" }}>
          <h1 style={{ color: "#10b981" }}>ההרשמה בוצעה בהצלחה!</h1>
          <p>פרטיך נשמרו בהצלחה במערכת. ניצור איתך קשר בהקדם.</p>
          <button 
            type="button" 
            onClick={() => navigate("/")} 
            className="btn btn-primary"
            style={{ marginTop: "20px", padding: "10px 20px" }}
          >
            חזרה לדף הבית
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="registration-page" dir="rtl">
      <div className="registration-card">
        <h1>הרשמה להתנדבות</h1>
        <p>אנא מלאו את הפרטים לצורך הרשמה להתנדבות.</p>

        <form onSubmit={handleSubmit}>
          <input name="firstName" placeholder="שם פרטי" value={formData.firstName} onChange={handleChange} required />
          <input name="lastName" placeholder="שם משפחה" value={formData.lastName} onChange={handleChange} required />
          <input name="email" type="email" placeholder="אימייל" value={formData.email} onChange={handleChange} required />
          <input name="phone" placeholder="טלפון" value={formData.phone} onChange={handleChange} required />
          <input name="age" type="number" placeholder="גיל" value={formData.age} onChange={handleChange} required />
          <input name="birthDate" type="date" value={formData.birthDate} onChange={handleChange} required />
          <input name="experience" placeholder="ניסיון קודם" value={formData.experience} onChange={handleChange} />
          <input name="address" placeholder="כתובת" value={formData.address} onChange={handleChange} />
          <input name="school" placeholder="בית ספר / מוסד לימודים" value={formData.school} onChange={handleChange} />
          
          <div style={{ margin: "15px 0", textAlign: "right" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>העלאת חתימה (Signature Upload):</label>
            <input 
              type="file" 
              accept="image/*" 
              onChange={handleFileChange} 
              style={{ width: "100%", padding: "5px" }} 
            />
            <input 
              name="signatureName" 
              placeholder="חתימה דיגיטלית (שם מלא)" 
              value={formData.signatureName} 
              onChange={handleChange} 
              style={{ marginTop: "8px" }}
            />
          </div>

          <button type="submit">שליחת הרשמה</button>
        </form>
      </div>
    </div>
  );
}

export default RegistrationScreen;