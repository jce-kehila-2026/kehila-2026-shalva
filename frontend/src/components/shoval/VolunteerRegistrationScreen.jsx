import React, { useState } from "react";
import { db } from "../../firebase";
import { collection, addDoc } from "firebase/firestore";
import { GROUP_NAMES } from "./groupOptions";
import "./RegistrationScreen.css";

function VolunteerRegistrationScreen() {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    age: "",
    birthDate: "",
    experience: "",
    address: "",
    school: "",
    additionDay: "",
    signature: "",
    groupName: "",
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    await addDoc(collection(db, "volunteers"), {
      ...formData,
      age: Number(formData.age),
      createdAt: new Date(),
    });

    alert("Volunteer added successfully!");
  };

  return (
    <div className="registration-page">
      <div className="registration-card">
        <h1>Volunteer Registration</h1>

        <form onSubmit={handleSubmit}>
          <input name="firstName" placeholder="First Name" onChange={handleChange} required />
          <input name="lastName" placeholder="Last Name" onChange={handleChange} required />
          <input name="email" type="email" placeholder="Email" onChange={handleChange} required />
          <input name="age" type="number" placeholder="Age" onChange={handleChange} required />
          <input name="birthDate" type="date" onChange={handleChange} required />
          <input name="experience" placeholder="Experience" onChange={handleChange} />
          <input name="address" placeholder="Address" onChange={handleChange} />
          <input name="school" placeholder="School" onChange={handleChange} />
          <input name="additionDay" type="date" onChange={handleChange} />
          <input name="signature" placeholder="Signature file URL / name" onChange={handleChange} />

          <select name="groupName" onChange={handleChange} required>
            <option value="">Select Group</option>
            {GROUP_NAMES.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>

          <button type="submit">Add Volunteer</button>
        </form>
      </div>
    </div>
  );
}

export default VolunteerRegistrationScreen;