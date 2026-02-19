import os
import ssl
import uuid
from pathlib import Path
from typing import Any, Optional
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

_raw_database_url = (os.getenv("DATABASE_URL") or "").strip()

def _sanitize_database_url(url: str) -> str:
    if not url:
        return url
    parsed = urlparse(url)
    query_items = [
        (k, v)
        for (k, v) in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in {"ssl", "ssl_ca", "sslcert", "sslkey", "sslcapath"}
    ]
    return urlunparse(parsed._replace(query=urlencode(query_items)))

DATABASE_URL = _sanitize_database_url(_raw_database_url)

def _build_ssl_context() -> ssl.SSLContext:
    ca_path = (os.getenv("MYSQL_SSL_CA") or "").strip()
    if ca_path:
        return ssl.create_default_context(cafile=ca_path)
    return ssl.create_default_context()

_engine: Optional[Engine] = (
    create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        connect_args={"ssl": _build_ssl_context()},  
    )
    if DATABASE_URL
    else None
)


def is_db_enabled() -> bool:
    return _engine is not None


def fetch_all(sql: str, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    if _engine is None:
        raise RuntimeError("DATABASE_URL not configured")
    with _engine.connect() as connection:
        result = connection.execute(text(sql), params or {})
        return [dict(row._mapping) for row in result]


def fetch_one(sql: str, params: Optional[dict[str, Any]] = None) -> Optional[dict[str, Any]]:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Optional[dict[str, Any]] = None) -> None:
    if _engine is None:
        raise RuntimeError("DATABASE_URL not configured")
    with _engine.begin() as connection:
        connection.execute(text(sql), params or {})


def execute_and_return_id(sql: str, params: Optional[dict[str, Any]] = None) -> Optional[str]:
    """Execute INSERT and return LAST_INSERT_ID() from the same connection."""
    if _engine is None:
        raise RuntimeError("DATABASE_URL not configured")
    with _engine.begin() as connection:
        connection.execute(text(sql), params or {})
        row = connection.execute(text("SELECT LAST_INSERT_ID() AS id")).fetchone()
        return str(row[0]) if row and row[0] else None

def create_manual_patient(user_data, patient_data, doctor_id):
    user_id = str(uuid.uuid4())
    temp_email = f"paciente_{user_id[:8]}@irhis_sistema.com"
    
    execute(
        """
        INSERT INTO users (ID, Email, Password, FirstName, LastName, Role, Active, Deleted)
        VALUES (:id, :email, :password, :fname, :lname, 'Patient', 1, 0)
        """,
        {
            "id": user_id,
            "email": temp_email,
            "password": "Mudar123!", 
            "fname": user_data.get('first_name'),
            "lname": user_data.get('last_name', '')
        }
    )

    execute(
        """
        INSERT INTO patient (
            UserID, BirthDate, Sex, Weight, Height, BMI, Occupation, Education,
            AffectedRightKnee, AffectedLeftKnee, AffectedRightHip, AffectedLeftHip,
            MedicalHistory, TimeAfterSymptoms, LegDominance, PhysicallyActive
        )
        VALUES (
            :user_id, :birth_date, :sex, :weight, :height, :bmi, :occupation, :education,
            :ark, :alk, :arh, :alh, :med_hist, :tas, :leg_dom, :active
        )
        """,
        {
            "user_id": user_id,
            "birth_date": patient_data.get('birth_date'),
            "sex": patient_data.get('sex'),
            "weight": patient_data.get('weight'),
            "height": patient_data.get('height'),
            "bmi": patient_data.get('bmi'),
            "occupation": patient_data.get('occupation'),
            "education": patient_data.get('education'),
            "ark": patient_data.get('affected_right_knee'),
            "alk": patient_data.get('affected_left_knee'),
            "arh": patient_data.get('affected_right_hip'),
            "alh": patient_data.get('affected_left_hip'),
            "med_hist": patient_data.get('medical_history'),
            "tas": patient_data.get('time_after_symptoms'),
            "leg_dom": patient_data.get('leg_dominance'),
            "active": patient_data.get('physically_active', 0)
        }
    )

    assign_patient_to_doctor(patient_id=user_id, doctor_id=doctor_id)

    return user_id, temp_email

def get_doctor_patient_ids(doctor_id: str) -> list[str]:
    rows = fetch_all(
        """
        SELECT PatientID
        FROM patientdoctor
        WHERE DoctorID = :doctor_id AND Active = 1
        """,
        {"doctor_id": doctor_id},
    )
    return [row["PatientID"] for row in rows]

def list_doctor_patients(doctor_id: str) -> list[dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT
          u.ID AS id,
          TRIM(CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,''))) AS name,
          u.Email AS email
        FROM patientdoctor pd
        JOIN users u ON u.ID = pd.PatientID
        WHERE pd.DoctorID = :doctor_id
          AND pd.Active = 1
        ORDER BY u.FirstName, u.LastName
        """,
        {"doctor_id": doctor_id},
    )

    return [
        {
            "id": row["id"],
            "name": row.get("name") or "",
            "email": row.get("email") or "",
        }
        for row in rows
    ]

def list_unassigned_patients() -> list[dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT
          u.ID AS id,
          TRIM(CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,''))) AS name,
          u.Email AS email
        FROM users u
        WHERE u.Role = 'Patient'
          AND COALESCE(u.Deleted, 0) = 0
          AND NOT EXISTS (
            SELECT 1
            FROM patientdoctor pd
            WHERE pd.PatientID = u.ID
              AND pd.Active = 1
          )
        ORDER BY u.FirstName, u.LastName
        """
    )

    return [
        {
            "id": row["id"],
            "name": row.get("name") or "",
            "email": row.get("email") or "",
        }
        for row in rows
    ]

def get_patient_doctor_relation(patient_id: str, doctor_id: str):
    return fetch_one(
        """
        SELECT ID 
        FROM patientdoctor 
        WHERE PatientID = :patient_id 
          AND DoctorID = :doctor_id 
          AND Active = 1
        LIMIT 1
        """,
        {"patient_id": patient_id, "doctor_id": doctor_id}
    )

def assign_patient_to_doctor(patient_id: str, doctor_id: str) -> None:
    now = datetime.now(timezone.utc)
    new_entry_id = str(uuid.uuid4())

    execute(
        """
        UPDATE patientdoctor
        SET Active = 0, TimeActive = :now
        WHERE PatientID = :patient_id AND Active = 1
        """,
        {"patient_id": patient_id, "now": now},
    )

    execute(
        """
        INSERT INTO patientdoctor (ID, PatientID, DoctorID, Active, TimeCreated, TimeActive)
        VALUES (:id, :patient_id, :doctor_id, 1, :now, :now)
        """,
        {
            "id": new_entry_id, 
            "patient_id": patient_id, 
            "doctor_id": doctor_id, 
            "now": now
        },
    )

def get_user_for_login(email: str, role: str) -> Optional[dict[str, Any]]:
    return fetch_one(
        """
        SELECT
          ID,
          Email,
          Password,
          Role,
          FirstName,
          LastName,
          Active,
          Deleted
        FROM users
        WHERE Email = :email
          AND Role = :role
          AND Active = 1
          AND COALESCE(Deleted, 0) = 0
        LIMIT 1
        """,
        {"email": email, "role": role},
    )


def user_exists(email: str) -> bool:
    """Check if a user with the given email already exists."""
    result = fetch_one(
        """
        SELECT ID
        FROM users
        WHERE Email = :email
        LIMIT 1
        """,
        {"email": email},
    )
    return result is not None


def create_user(email: str, password_hash: str, first_name: str, last_name: str, role: str) -> str:
    """Create a new user in the database and return the user ID."""
    user_id = str(uuid.uuid4())
    execute(
        """
        INSERT INTO users (ID, Email, Password, FirstName, LastName, Role, Active, Deleted)
        VALUES (:id, :email, :password, :fname, :lname, :role, 1, 0)
        """,
        {
            "id": user_id,
            "email": email,
            "password": password_hash,
            "fname": first_name,
            "lname": last_name,
            "role": role,
        },
    )
    return user_id


def get_user_by_id(user_id: str) -> Optional[dict[str, Any]]:
    return fetch_one(
        """
        SELECT
          ID,
          Email,
          Role,
          FirstName,
          LastName
        FROM users
        WHERE ID = :id
          AND Active = 1
          AND COALESCE(Deleted, 0) = 0
        """,
        {"id": user_id},
    )

def get_patient_by_id(patient_id: str) -> Optional[dict[str, Any]]:
    """Get patient data by joining users and patient tables."""
    return fetch_one(
        """
        SELECT
          u.ID,
          u.Email,
          u.FirstName,
          u.LastName,
          u.Role,
          p.BirthDate,
          p.Sex,
          p.Weight,
          p.Height,
          p.BMI,
          p.Occupation,
          p.Education,
          p.MedicalHistory,
          p.TimeAfterSymptoms,
          p.LegDominance,
          p.PhysicallyActive
        FROM users u
        LEFT JOIN patient p ON p.UserID = u.ID
        WHERE u.ID = :id
          AND u.Active = 1
          AND COALESCE(u.Deleted, 0) = 0
        LIMIT 1
        """,
        {"id": patient_id},
    )

def create_patient_record(user_id: str, birth_date: Optional[str] = None) -> None:
    """Create a minimal patient record in the patient table. Sex is required (DB enum: male, female)."""
    execute(
        """
        INSERT INTO patient (
            UserID, BirthDate, Sex, Weight, Height, BMI, Occupation, Education,
            AffectedRightKnee, AffectedLeftKnee, AffectedRightHip, AffectedLeftHip,
            MedicalHistory, TimeAfterSymptoms, LegDominance, PhysicallyActive
        )
        VALUES (
            :user_id, :birth_date, 'male', NULL, NULL, NULL, NULL, NULL,
            0, 0, 0, 0, NULL, NULL, 'dominant', 0
        )
        """,
        {
            "user_id": user_id,
            "birth_date": birth_date,
        },
    )

def get_patient_sessions(patient_id: str):
    rows = fetch_all(
        """
        SELECT S.*, pd.PatientID
        FROM session s
        INNER JOIN patientdoctor pd ON pd.ID = s.RelationID
        WHERE pd.PatientID = :patientID;
        """,
        {"patientID": patient_id}
    )
    
    for row in rows:
        if row.get('Duration'):
            row['Duration'] = str(row['Duration'])
            
    return rows

def get_session_by_id(session_id: str):
    session = fetch_one(
        """
        SELECT s.*, pd.PatientID 
        FROM session s
        JOIN patientdoctor pd ON s.RelationID = pd.ID
        WHERE s.ID = :session_id
        """,
        {"session_id": session_id}
    )

    if session:
        if session.get('Duration'):
            session['Duration'] = str(session['Duration'])
            
    return session

def assign_session_to_patient(relation_id: str, exercise_type, exercise_description, repetitions, duration):
    """Create session. Deployed Session table requires explicit ID (no AUTO_INCREMENT default)."""
    now = datetime.now(timezone.utc)
    sid = str(uuid.uuid4())
    execute(
        """
        INSERT INTO session (ID, RelationID, ExerciseType, ExerciseDescription, Repetitions, Duration, TimeCreated)
        VALUES (:id, :relation_id, :exercise_type, :exercise_description, :repetitions, :duration, :now)
        """,
        {
            "id": sid,
            "relation_id": relation_id,
            "exercise_type": exercise_type,
            "exercise_description": exercise_description,
            "repetitions": repetitions,
            "duration": duration,
            "now": now
        },
    )
    return sid

def update_session_details(session_id, exercise_type, exercise_description, repetitions, duration):
    execute(
        """
        UPDATE session
        SET ExerciseType = :exercise_type, 
            ExerciseDescription = :exercise_description, 
            Repetitions = :repetitions, 
            Duration = :duration
        WHERE ID = :session_id
        """,
        {
            "session_id": session_id,
            "exercise_type": exercise_type,
            "exercise_description": exercise_description,
            "repetitions": repetitions,
            "duration": duration
        }
    )

def delete_patient_session(session_id):
    """Delete session. Azure schema: remove metrics and feedback first (FKs), then session."""
    execute("DELETE FROM metrics WHERE SessionID = :sid", {"sid": session_id})
    execute("DELETE FROM PatientFeedback WHERE SessionID = :sid", {"sid": session_id})
    execute("DELETE FROM session WHERE ID = :session_id", {"session_id": session_id})

def insert_session_metrics(session_id, data):
    # Deployed Metrics table requires explicit ID (no AUTO_INCREMENT default)
    joint = (data.get('joint') or 'knee').lower()
    if joint not in ('knee', 'hip'):
        return None  # Skip COM and other invalid joints
    mid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    raw_side = (data.get('side') or 'both').lower()
    side = raw_side if raw_side in ('left', 'right') else 'left'
    repetition = int(data.get('repetition') or 0)
    min_v = float(data.get('min_velocity') or 0)
    max_v = float(data.get('max_velocity') or 0)
    avg_v = float(data.get('avg_velocity') or 0)
    p95_v = float(data.get('p95_velocity') or 0)
    min_rom = float(data.get('min_rom') or 0)
    max_rom = float(data.get('max_rom') or 0)
    avg_rom = float(data.get('avg_rom') or 0)
    cmd = float(data.get('center_mass_displacement') or 0)

    execute(
        """
        INSERT INTO metrics (
            ID, SessionID, Joint, Side, Repetitions,
            MinVelocity, MaxVelocity, AvgVelocity, P95Velocity,
            MinROM, MaxROM, AvgROM, CenterMassDisplacement, TimeCreated
        )
        VALUES (
            :id, :session_id, :joint, :side, :repetition,
            :min_v, :max_v, :avg_v, :p95_v,
            :min_rom, :max_rom, :avg_rom, :cmd, :now
        )
        """,
        {
            "id": mid,
            "session_id": session_id,
            "joint": joint,
            "side": side,
            "repetition": repetition,
            "min_v": min_v,
            "max_v": max_v,
            "avg_v": avg_v,
            "p95_v": p95_v,
            "min_rom": min_rom,
            "max_rom": max_rom,
            "avg_rom": avg_rom,
            "cmd": cmd,
            "now": now
        }
    )
    return mid

def get_metrics_by_patient(patient_id, limit=10):
    rows = fetch_all(
        """
        SELECT m.*, s.ExerciseType
        FROM metrics m
        JOIN session s ON m.SessionID = s.ID
        JOIN patientdoctor pd ON s.RelationID = pd.ID
        WHERE pd.PatientID = :patient_id
        ORDER BY s.TimeCreated DESC, m.Repetitions ASC -- Ajustado para o plural aqui também
        LIMIT :limit
        """,
        {"patient_id": patient_id, "limit": limit}
    )
    
    for row in rows:
        if row.get('TimeCreated'): row['TimeCreated'] = str(row['TimeCreated'])
        if row.get('SessionDate'): row['SessionDate'] = str(row['SessionDate'])
            
    return rows

def get_metrics_by_session(session_id: str):
    rows = fetch_all(
        """
        SELECT * FROM metrics 
        WHERE SessionID = :session_id
        ORDER BY Repetitions ASC -- Ajustado para o plural
        """,
        {"session_id": session_id}
    )
    
    for row in rows:
        if row.get('TimeCreated'):
            row['TimeCreated'] = str(row['TimeCreated'])

    return rows


def update_patient_details(patient_id: str, details: dict) -> None:
    """Update patient record. patient_id is UserID. Details: weight, height, bmi, sex, medical_history."""
    if not details:
        return
    # Ensure patient row exists (create if missing)
    existing = fetch_one(
        "SELECT UserID FROM patient WHERE UserID = :pid LIMIT 1",
        {"pid": patient_id},
    )
    if not existing:
        try:
            create_patient_record(patient_id, birth_date=None)
        except Exception:
            pass

    updates = []
    params = {}
    if "weight" in details and details["weight"] is not None:
        updates.append("Weight = :weight")
        params["weight"] = float(details["weight"])
    if "height" in details and details["height"] is not None:
        updates.append("Height = :height")
        params["height"] = float(details["height"]) * 100  # m to cm
    if "bmi" in details and details["bmi"] is not None:
        updates.append("BMI = :bmi")
        params["bmi"] = float(details["bmi"])
    elif "weight" in details and "height" in details:
        w, h = float(details.get("weight", 0)), float(details.get("height", 0))
        if h > 0 and w > 0:
            updates.append("BMI = :bmi")
            params["bmi"] = w / (h * h)
    if "sex" in details and details["sex"] is not None:
        raw = str(details["sex"]).strip().lower()
        if raw in ("male", "female"):
            updates.append("Sex = :sex")
            params["sex"] = raw
    if "clinicalInfo" in details:
        updates.append("MedicalHistory = :medical_history")
        params["medical_history"] = str(details["clinicalInfo"])[:4096]
    if "medicalHistory" in details:
        updates.append("MedicalHistory = :medical_history")
        params["medical_history"] = str(details["medicalHistory"])[:4096]
    # Age: convert to BirthDate (birth_date = today - age years)
    age_val = details.get("age") or details.get("Age")
    if age_val is not None:
        try:
            age_int = int(float(age_val))
            if 0 <= age_int <= 120:
                from datetime import date
                today = date.today()
                birth_date = date(today.year - age_int, today.month, today.day)
                updates.append("BirthDate = :birth_date")
                params["birth_date"] = birth_date.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            pass

    if not updates:
        return
    params["pid"] = patient_id
    execute(
        f"UPDATE patient SET {', '.join(updates)} WHERE UserID = :pid",
        params,
    )


def insert_feedback(patient_id: str, feedback: dict) -> str:
    """Insert a feedback record into PatientFeedback. Returns feedback ID."""
    pain = int(feedback.get("pain", 0))
    fatigue = int(feedback.get("fatigue", 0))
    difficulty = int(feedback.get("difficulty", 0))
    comments = feedback.get("comments") or ""
    session_id = feedback.get("sessionId")
    fid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    execute(
        """
        INSERT INTO PatientFeedback (ID, UserID, SessionID, Pain, Fatigue, Difficulty, Comments, TimeCreated)
        VALUES (:id, :user_id, :session_id, :pain, :fatigue, :difficulty, :comments, :now)
        """,
        {
            "id": fid,
            "user_id": patient_id,
            "session_id": session_id,
            "pain": pain,
            "fatigue": fatigue,
            "difficulty": difficulty,
            "comments": comments[:4096] if comments else None,
            "now": now,
        },
    )
    return fid


def get_feedback_by_patient(patient_id: str, limit: int = 100):
    """Get feedback entries for a patient from PatientFeedback."""
    return fetch_all(
        """
        SELECT ID, UserID AS PatientID, SessionID, TimeCreated AS FeedbackTime, Pain, Fatigue, Difficulty, Comments
        FROM PatientFeedback
        WHERE UserID = :patient_id
        ORDER BY TimeCreated DESC
        LIMIT :limit
        """,
        {"patient_id": patient_id, "limit": limit},
    )