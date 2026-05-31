import { useState } from "react";
import { db } from "../firebase";
import { collection, addDoc } from "firebase/firestore";
import "./RegistrationScreen.css";

function RegistrationScreen() {
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
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await addDoc(collection(db, "registrants"), {
        ...formData,
        age: Number(formData.age),
        createdAt: new Date(),
      });

      alert("פרטיך נשמרו בהצלחה! ניצור איתך קשר בהקדם.");

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
      });
    } catch (error) {
      console.error("Error saving registration:", error);
      alert("אירעה שגיאה בשליחת ההרשמה");
    }
  };

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

          <button type="submit">שליחת הרשמה</button>
        </form>
      </div>
    </div>
  );
}

export default RegistrationScreen;