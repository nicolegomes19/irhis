import os
import base64
import json
import jwt as PyJWT
import zipfile
import io
import csv

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta, timezone
from functools import wraps
from db import (
    is_db_enabled,
    list_doctor_patients,
    list_unassigned_patients,
    assign_patient_to_doctor,
    get_doctor_patient_ids,
    get_user_by_id,
    get_user_for_login,
    get_patient_sessions,
    assign_session_to_patient,
    get_patient_doctor_relation,
    get_session_by_id,
    update_session_details,
    delete_patient_session,
    create_manual_patient,
    insert_session_metrics,
    get_metrics_by_patient,
    get_metrics_by_session,
    execute,
    fetch_one,
    get_patient_by_id,
    create_patient_record,
    user_exists,
    create_user,
    update_patient_details as db_update_patient_details,
    insert_feedback,
    get_feedback_by_patient,
)


app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = 'your-secret-key'  

hashed_password_doctor = generate_password_hash('password')


default_patient_details = {
    "age": 0, "sex": "N/A", "height": 0, "weight": 0, "bmi": 0,
    "clinicalInfo": "No information provided."
}


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        if 'Authorization' in request.headers:
            parts = request.headers['Authorization'].split(' ')
            if len(parts) == 2:
                token = parts[1]

        if not token:
            return jsonify({'error': 'Token is missing'}), 401

        try:
            data = PyJWT.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            user_data = get_user_by_id(str(data['user_id']))
            
            if not user_data:
                return jsonify({'error': 'Invalid token'}), 401

            current_user = {
                'id': str(user_data.get('ID')),
                'role': user_data.get('Role'),
                'email': user_data.get('Email'),
                'name': f"{user_data.get('FirstName','')} {user_data.get('LastName','')}".strip()
            }

        except Exception as e:
            return jsonify({'error': 'Invalid token'}), 401

        return f(current_user, *args, **kwargs)

    return decorated

@app.route("/")
def home():
    return "irhis Backend"

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()

    email = data.get('email')
    password = data.get('password')
    role = data.get('role')

    if not email or not password or not role:
        return jsonify({"error": "Missing email, password, or role"}), 400

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    user = get_user_for_login(email, role)

    if not user:
        return jsonify({"error": "Invalid credentials"}), 401

    if not check_password_hash(user["Password"], password):
        return jsonify({"error": "Invalid credentials"}), 401

    token = PyJWT.encode(
        {
            "user_id": str(user["ID"]),
            "role": user["Role"],
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        },
        app.config["SECRET_KEY"],
        algorithm="HS256",
    )

    return jsonify({
        "token": token,
        "user": {
            "id": str(user["ID"]),
            "email": user["Email"],
            "name": f"{user.get('FirstName','')} {user.get('LastName','')}".strip(),
            "role": user["Role"],
        }
    }), 200


@app.route('/signup', methods=['POST'])
def signup():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        role = data.get('role')
        name = data.get('name')

        if not all([email, password, role, name]):
            return jsonify({"error": "Missing required fields"}), 400

        if not is_db_enabled():
            return jsonify({"error": "Database not configured"}), 500

        # Normalize role to match database enum (Patient/Doctor)
        normalized_role = "Doctor" if role.lower() == "doctor" else "Patient"

        # Check if email already exists
        try:
            if user_exists(email):
                return jsonify({"error": "Email already registered"}), 409
        except Exception as e:
            import traceback
            return jsonify({"error": f"Error checking email: {str(e)}", "traceback": traceback.format_exc()}), 500

        # Parse name into first and last name
        name_parts = name.strip().split(maxsplit=1)
        first_name = name_parts[0] if name_parts else ""
        last_name = name_parts[1] if len(name_parts) > 1 else ""

        # Hash password and create user in database
        hashed_password = generate_password_hash(password)
        
        try:
            user_id = create_user(email, hashed_password, first_name, last_name, normalized_role)
            
            # If patient, create a patient record in the patient table
            if normalized_role == "Patient":
                try:
                    # Extract birth date from name_parts if provided (for future use)
                    # For now, create patient record without birth date
                    create_patient_record(user_id, birth_date=None)
                except Exception as e:
                    # Log but don't fail signup if patient record creation fails
                    # The patient record can be created later
                    print(f"Warning: Failed to create patient record: {e}")
        except Exception as e:
            import traceback
            return jsonify({"error": f"Failed to create user: {str(e)}", "traceback": traceback.format_exc()}), 500

        # Generate token
        token = PyJWT.encode(
            {
                "user_id": user_id,
                "role": normalized_role,
                "exp": datetime.now(timezone.utc) + timedelta(days=1),
            },
            app.config["SECRET_KEY"],
            algorithm="HS256",
        )

        return jsonify({
            "token": token,
            "user": {
                "id": user_id,
                "email": email,
                "name": name,
                "role": normalized_role
            }
        }), 201
    except Exception as e:
        import traceback
        return jsonify({"error": f"Unexpected error: {str(e)}", "traceback": traceback.format_exc()}), 500

@app.route('/me', methods=['GET'])
@token_required
def get_current_user(current_user):
    return jsonify(current_user)

@app.route('/patients/<patient_id>', methods=['GET'])
@token_required
def get_patient(current_user, patient_id):
    # Check if user has access to this patient
    user_role_lower = current_user.get('role', '').lower() if current_user.get('role') else ''
    is_doctor = user_role_lower == 'doctor'
    is_own_patient = current_user.get('id') == patient_id
    
    if not is_doctor and not is_own_patient:
        return jsonify({"error": "Unauthorized"}), 403

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    # Get patient from database
    patient_data = get_patient_by_id(patient_id)
    if not patient_data:
        # Patient requesting own profile: we have current_user from token, so user exists
        if is_own_patient:
            feedback_rows = get_feedback_by_patient(patient_id, limit=50)
            feedback_list = [
                {
                    "id": r.get("ID"),
                    "sessionId": r.get("SessionID"),
                    "timestamp": str(r.get("FeedbackTime", r.get("Timestamp", ""))),
                    "pain": r.get("Pain", 0),
                    "fatigue": r.get("Fatigue", 0),
                    "difficulty": r.get("Difficulty", 0),
                    "comments": r.get("Comments"),
                }
                for r in feedback_rows
            ]
            return jsonify({
                "id": current_user.get('id'),
                "name": current_user.get('name', ''),
                "details": {
                    "age": 0,
                    "birthDate": None,
                    "sex": "Other",
                    "height": 0,
                    "weight": 0,
                    "bmi": 0,
                    "clinicalInfo": "No information provided.",
                    "medicalHistory": None,
                },
                "recovery_process": [],
                "feedback": feedback_list,
            })
        # Doctor requesting patient: try to create patient record if user exists
        user_data = get_user_by_id(patient_id)
        if user_data and user_data.get('Role') in ('Patient', 'patient'):
            try:
                create_patient_record(patient_id, birth_date=None)
                patient_data = get_patient_by_id(patient_id)
            except Exception:
                pass
        if not patient_data:
            return jsonify({"error": "Patient not found"}), 404

    # Calculate age from birth date if available
    age = 0
    if patient_data.get('BirthDate'):
        try:
            from datetime import datetime
            birth_date = datetime.strptime(patient_data['BirthDate'], '%Y-%m-%d')
            today = datetime.now()
            age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
        except:
            pass

    # Map sex enum to frontend format
    sex_map = {
        'male': 'Male',
        'female': 'Female',
    }
    sex = sex_map.get(patient_data.get('Sex', '').lower(), 'Other')

    # Convert height from cm to meters if available
    height = patient_data.get('Height')
    if height:
        height = height / 100

    # Build patient response
    try:
        feedback_rows = get_feedback_by_patient(patient_id, limit=50)
        feedback_list = [
            {
                "id": r.get("ID"),
                "sessionId": r.get("SessionID"),
                "timestamp": str(r.get("FeedbackTime", r.get("Timestamp", ""))),
                "pain": r.get("Pain", 0),
                "fatigue": r.get("Fatigue", 0),
                "difficulty": r.get("Difficulty", 0),
                "comments": r.get("Comments"),
            }
            for r in feedback_rows
        ]
        patient = {
            "id": patient_data.get('ID') or patient_id,
            "name": f"{patient_data.get('FirstName', '')} {patient_data.get('LastName', '')}".strip() or patient_data.get('Email', ''),
            "details": {
                "age": age,
                "birthDate": patient_data.get('BirthDate'),
                "sex": sex,
                "height": height or 0,
                "weight": patient_data.get('Weight') or 0,
                "bmi": patient_data.get('BMI') or 0,
                "clinicalInfo": patient_data.get('MedicalHistory') or 'No information provided.',
                "medicalHistory": patient_data.get('MedicalHistory'),
            },
            "recovery_process": [],
            "feedback": feedback_list,
        }
        return jsonify(patient)
    except Exception as e:
        import traceback
        return jsonify({"error": f"Error building patient response: {str(e)}", "traceback": traceback.format_exc()}), 500

@app.route('/doctors/<doctor_id>/patients', methods=['GET'])
@token_required
def get_doctor_patients(current_user, doctor_id):
    if current_user['role'].lower() != 'doctor' or current_user['id'].lower() != doctor_id:
        return jsonify({"error": "Unauthorized"}), 403

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    rows = list_doctor_patients(doctor_id)
    return jsonify([
        {
            "id": r["id"],
            "name": r.get("name") or "",
            "recovery_process": [],
            "details": default_patient_details,
        }
        for r in rows
    ])


@app.route('/doctors/me/patients', methods=['GET'])
@token_required
def get_doctors_me_patients(current_user):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    doctor_id = current_user['id']
    search = request.args.get('search', '').lower()
    sort = request.args.get('sort', 'name')

    rows = list_doctor_patients(doctor_id)

    items = []
    for r in rows:
        name = (r.get("name") or "").strip()

        if search and search not in name.lower():
            continue

        items.append({
            "type": "patient",
            "id": str(r["id"]),
            "name": name,
            "email": r.get("email") or "",
            "nif": "",
            "status": "Confirmed",

            "lastSessionAt": None,
            "lastFeedbackAt": None,
            "sessionCount": 0,
            "lastAvgROM": None,
            "lastAvgVelocity": None,
        })

    if sort == "name":
        items.sort(key=lambda x: x.get("name", ""))

    return jsonify({
        "items": items,
        "confirmed": items,
        "pending": [],
    })


@app.route('/patients/unassigned', methods=['GET'])
@token_required
def get_unassigned_patients(current_user):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    rows = list_unassigned_patients()
    return jsonify([
        {
            "id": str(r["id"]),
            "name": r.get("name") or "",
            "recovery_process": [],
            "details": default_patient_details,
        }
        for r in rows
    ])





@app.route('/patients/<patient_id>/assign-doctor', methods=['POST'])
@token_required
def assign_doctor(current_user, patient_id):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Only doctors can assign patients"}), 403

    doctor_id = current_user['id']

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    assign_patient_to_doctor(patient_id, doctor_id)
    return jsonify({"message": "Patient assigned successfully"})

@app.route('/patients/<patient_id>/recovery-process', methods=['PUT'])
@token_required
def update_recovery_process(current_user, patient_id):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Only doctors can update exercises"}), 403

    if patient_id not in patients:
        return jsonify({"error": "Patient not found"}), 404
    
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({"error": "Invalid data format, expected a list of exercises"}), 400
    
    patients[patient_id]['recovery_process'] = data
    
    return jsonify(patients[patient_id])

@app.route('/patients/<patient_id>/details', methods=['PUT'])
@token_required
def update_patient_details(current_user, patient_id):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Only doctors can update patient details"}), 403

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing data"}), 400

    details = data.get('details', data)
    if not details:
        return jsonify({"error": "Missing details"}), 400

    try:
        db_update_patient_details(patient_id, details)
        patient_data = get_patient_by_id(patient_id)
        if not patient_data:
            return jsonify({"error": "Patient not found"}), 404

        def _get(d, *keys):
            for k in keys:
                if k in d:
                    return d[k]
                for kk in d:
                    if kk and str(kk).lower() == str(k).lower():
                        return d[kk]
            return None

        age = _get(patient_data, 'Age', 'age') or 0
        birth_date_val = _get(patient_data, 'BirthDate', 'birth_date')
        if birth_date_val:
            try:
                from datetime import datetime
                birth_date = datetime.strptime(str(birth_date_val), '%Y-%m-%d')
                today = datetime.now()
                age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
            except Exception:
                pass
        sex_map = {'male': 'Male', 'female': 'Female'}
        sex_raw = _get(patient_data, 'Sex', 'sex') or ''
        sex = sex_map.get(str(sex_raw).lower(), 'Other')
        height = _get(patient_data, 'Height', 'height')
        if height:
            height = height / 100
        patient = {
            "id": _get(patient_data, 'ID', 'id') or patient_id,
            "name": f"{_get(patient_data, 'FirstName', 'firstname') or ''} {_get(patient_data, 'LastName', 'lastname') or ''}".strip() or _get(patient_data, 'Email', 'email') or '',
            "details": {
                "age": age,
                "birthDate": birth_date_val,
                "sex": sex,
                "height": height or 0,
                "weight": _get(patient_data, 'Weight', 'weight') or 0,
                "bmi": _get(patient_data, 'BMI', 'bmi') or 0,
                "clinicalInfo": _get(patient_data, 'MedicalHistory', 'medicalhistory') or 'No information provided.',
                "medicalHistory": _get(patient_data, 'MedicalHistory', 'medicalhistory'),
            },
            "recovery_process": [],
            "feedback": [],
        }
        return jsonify(patient)
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500

@app.route('/patients/<patient_id>/feedback', methods=['PUT'])
@token_required
def update_patient_feedback(current_user, patient_id):
    if current_user['role'] == 'patient' and current_user['id'] != patient_id:
        return jsonify({"error": "Patients can only update their own feedback"}), 403

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    data = request.get_json()
    if not data or 'feedback' not in data:
        return jsonify({"error": "Missing feedback data"}), 400

    feedback_payload = data['feedback']
    entries = feedback_payload if isinstance(feedback_payload, list) else [feedback_payload]

    try:
        for entry in entries:
            insert_feedback(patient_id, entry)
        patient_data = get_patient_by_id(patient_id)
        feedback_rows = get_feedback_by_patient(patient_id, limit=50)
        feedback_list = [
            {
                "id": r.get("ID"),
                "sessionId": r.get("SessionID"),
                "timestamp": str(r.get("FeedbackTime", r.get("Timestamp", ""))),
                "pain": r.get("Pain", 0),
                "fatigue": r.get("Fatigue", 0),
                "difficulty": r.get("Difficulty", 0),
                "comments": r.get("Comments"),
            }
            for r in feedback_rows
        ]
        return jsonify({
            "id": patient_id,
            "name": f"{patient_data.get('FirstName', '')} {patient_data.get('LastName', '')}".strip() if patient_data else "",
            "feedback": feedback_list,
        })
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500

@app.route('/doctors/me/metrics-summary', methods=['GET'])
@token_required
def get_doctors_me_metrics_summary(current_user):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    doctor_id = current_user['id']

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500
    
    patient_ids = get_doctor_patient_ids(doctor_id)
    
    metrics_summary = []
    for patient_id in patient_ids:
        patient = get_patient_by_id(patient_id)
        fname = (patient or {}).get('FirstName') or (patient or {}).get('first_name') or ''
        lname = (patient or {}).get('LastName') or (patient or {}).get('last_name') or ''
        patient_name = f"{fname} {lname}".strip() or 'Unknown'
        metrics_rows = get_metrics_by_patient(patient_id, limit=20) or []
        movement_analyses = [
            {"result": {
                "joint": r.get('Joint') or r.get('joint'),
                "side": r.get('Side') or r.get('side'),
                "avgROM": r.get('AvgROM') if r.get('AvgROM') is not None else r.get('avgROM'),
                "avgVelocity": r.get('AvgVelocity') if r.get('AvgVelocity') is not None else r.get('avgVelocity'),
            }, "timestamp": r.get('TimeCreated') or r.get('timeCreated') or '', "exercise_type": r.get('ExerciseType') or r.get('exerciseType') or 'general'}
            for r in metrics_rows
        ]
        
        for analysis in movement_analyses:
            result = analysis.get('result', {})
            if isinstance(result, dict):
                # Extract metrics
                joint = result.get('joint', 'Unknown')
                side = result.get('side', '')
                avg_rom = result.get('avgROM') or result.get('rom')
                avg_velocity = result.get('avgVelocity') or result.get('velocity')
                
                metrics_summary.append({
                    "patientId": patient_id,
                    "patientName": patient_name,
                    "joint": joint,
                    "side": side,
                    "avgROM": avg_rom,
                    "avgVelocity": avg_velocity,
                    "date": analysis.get('timestamp', ''),
                    "exerciseType": analysis.get('exercise_type', 'general')
                })
    
    # Sort by date (most recent first) and return top 5
    metrics_summary.sort(key=lambda x: x.get('date', ''), reverse=True)
    return jsonify(metrics_summary[:5])

@app.route('/doctors/me/recent-activity', methods=['GET'])
@token_required
def get_doctors_me_recent_activity(current_user):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    doctor_id = current_user['id']

    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    patient_ids = get_doctor_patient_ids(doctor_id)
    
    # Build patients dict from DB (feedback has no table; use sessions as movement_analyses)
    patients = {}
    for pid in patient_ids:
        p = get_patient_by_id(pid)
        fname = (p or {}).get('FirstName') or (p or {}).get('first_name') or ''
        lname = (p or {}).get('LastName') or (p or {}).get('last_name') or ''
        name = f"{fname} {lname}".strip() or 'Unknown'
        sessions = get_patient_sessions(pid) or []
        movement_analyses = [
            {"timestamp": (s.get('TimeCreated') or s.get('timeCreated') or ''), "exercise_type": s.get('ExerciseType') or s.get('exerciseType') or 'general', "id": s.get('ID') or s.get('id')}
            for s in sessions
        ]
        patients[pid] = {"name": name, "feedback": [], "movement_analyses": movement_analyses}
    
    # Calculate date 7 days ago
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    
    recent_activity = []
    for patient_id in patient_ids:
        if patient_id not in patients:
            continue
        
        patient = patients[patient_id]
        patient_name = patient.get('name', '')
        
        # Get feedback from last 7 days
        feedback_list = patient.get('feedback', [])
        for feedback in feedback_list:
            timestamp_str = feedback.get('timestamp')
            if not timestamp_str:
                continue
            
            try:
                feedback_date = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                if feedback_date >= seven_days_ago:
                    recent_activity.append({
                        "type": "feedback",
                        "patientId": patient_id,
                        "patientName": patient_name,
                        "label": f"Pain: {feedback.get('pain', 'N/A')}/10, Fatigue: {feedback.get('fatigue', 'N/A')}/10",
                        "date": timestamp_str,
                        "sessionId": feedback.get('sessionId')
                    })
            except:
                pass
        
        # Get sessions from movement_analyses (last 7 days)
        movement_analyses = patient.get('movement_analyses', [])
        for analysis in movement_analyses:
            timestamp_str = analysis.get('timestamp')
            if not timestamp_str:
                continue
            
            try:
                analysis_date = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                if analysis_date >= seven_days_ago:
                    exercise_type = analysis.get('exercise_type', 'general')
                    recent_activity.append({
                        "type": "session",
                        "patientId": patient_id,
                        "patientName": patient_name,
                        "label": f"Exercise: {exercise_type}",
                        "date": timestamp_str,
                        "sessionId": analysis.get('id')
                    })
            except:
                pass
    
    # Sort by date (most recent first) and return top 5
    recent_activity.sort(key=lambda x: x.get('date', ''), reverse=True)
    return jsonify(recent_activity[:5])

@app.route('/doctors/me/trends', methods=['GET'])
@token_required
def get_doctors_me_trends(current_user):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    doctor_id = current_user['id']
    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500

    patient_ids = get_doctor_patient_ids(doctor_id)
    
    # Build patients dict from DB (feedback has no table; empty for now)
    patients = {}
    for pid in patient_ids:
        patients[pid] = {"feedback": []}
    
    # Calculate date 30 days ago
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    
    pain_scores = []
    fatigue_scores = []
    difficulty_scores = []
    
    for patient_id in patient_ids:
        if patient_id not in patients:
            continue
        
        feedback_list = patients[patient_id].get('feedback', [])
        for feedback in feedback_list:
            timestamp_str = feedback.get('timestamp')
            if not timestamp_str:
                continue
            
            try:
                feedback_date = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                if feedback_date >= thirty_days_ago:
                    if 'pain' in feedback:
                        pain_scores.append(feedback['pain'])
                    if 'fatigue' in feedback:
                        fatigue_scores.append(feedback['fatigue'])
                    if 'difficulty' in feedback:
                        difficulty_scores.append(feedback['difficulty'])
            except:
                pass
    
    # Calculate averages
    avg_pain = sum(pain_scores) / len(pain_scores) if pain_scores else 0
    avg_fatigue = sum(fatigue_scores) / len(fatigue_scores) if fatigue_scores else 0
    avg_difficulty = sum(difficulty_scores) / len(difficulty_scores) if difficulty_scores else 0
    
    return jsonify({
        "avgPain": round(avg_pain, 2),
        "avgFatigue": round(avg_fatigue, 2),
        "avgDifficulty": round(avg_difficulty, 2)
    })

# Movement Analysis API Integration
MOVEMENT_API_BASE_URL = "https://eucp-movement-analysis-api-dev.azurewebsites.net"

@app.route('/movement/health', methods=['GET'])
@token_required
def check_movement_api_health(current_user):
    """Check if the external movement analysis API is healthy"""
    try:
        import requests
        response = requests.get(f"{MOVEMENT_API_BASE_URL}/health", timeout=10)
        if response.status_code == 200:
            return jsonify({"status": "ok", "external_api": response.json()})
        else:
            return jsonify({"status": "error", "message": "External API not responding"}), 503
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 503

@app.route('/movement/analyze', methods=['POST'])
@token_required
def analyze_movement_data(current_user):
    """Upload and analyze movement data using external API"""
    try:
        import requests
        
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Get additional parameters
        patient_id = request.form.get('patient_id')
        exercise_type = request.form.get('exercise_type', 'general')
        
        # Validate patient access
        if current_user['role'] == 'patient' and current_user['id'] != patient_id:
            return jsonify({"error": "Patients can only analyze their own data"}), 403
        
        if current_user['role'] == 'doctor' and patient_id:
            # Check if doctor has access to this patient
            if patient_id not in patients:
                return jsonify({"error": "Patient not found"}), 404
        
        # Forward file to external API
        files = {'file': (file.filename, file.stream, file.content_type)}
        
        response = requests.post(
            f"{MOVEMENT_API_BASE_URL}/analyze",
            files=files,
            timeout=60  # Longer timeout for analysis
        )
        
        if response.status_code == 200:
            analysis_result = response.json()
            
            # Store analysis result in patient data if patient_id provided
            if patient_id and patient_id in patients:
                if 'movement_analyses' not in patients[patient_id]:
                    patients[patient_id]['movement_analyses'] = []
                
                analysis_record = {
                    'id': f"analysis_{datetime.now().timestamp()}",
                    'timestamp': datetime.now().isoformat(),
                    'exercise_type': exercise_type,
                    'file_name': file.filename,
                    'result': analysis_result,
                    'analyzed_by': current_user['id']
                }
                
                patients[patient_id]['movement_analyses'].append(analysis_record)
            
            return jsonify({
                "success": True,
                "message": "Analysis completed successfully",
                "result": analysis_result
            })
        else:
            return jsonify({
                "success": False,
                "message": "External API analysis failed",
                "error": response.text
            }), 502
            
    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Analysis failed",
            "error": str(e)
        }), 500

@app.route('/patients/<patient_id>/movement-analyses', methods=['GET'])
@token_required
def get_patient_movement_analyses(current_user, patient_id):
    """Get movement analysis history for a patient"""
    # Check if user has access to this patient
    if current_user['role'] != 'doctor' and current_user['id'] != patient_id:
        return jsonify({"error": "Unauthorized"}), 403

    patient = patients.get(patient_id)
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    
    analyses = patient.get('movement_analyses', [])
    return jsonify({"analyses": analyses})

@app.route('/movement/test-integration', methods=['GET'])
@token_required
def test_movement_integration(current_user):
    """Test integration with external movement analysis API"""
    try:
        import requests
        response = requests.get(f"{MOVEMENT_API_BASE_URL}/integration_test", timeout=10)
        
        if response.status_code == 200:
            return jsonify({
                "success": True,
                "message": "Integration test passed",
                "external_api_response": response.json()
            })
        else:
            return jsonify({
                "success": False,
                "message": "Integration test failed",
                "status_code": response.status_code
            }), 502
            
    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Integration test failed",
            "error": str(e)
        }), 500

@app.route('/patients/manual-registry', methods=['POST'])
@token_required
def register_patient_manual(current_user):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Acesso negado"}), 403

    data = request.json
    doctor_id = current_user['id'] 

    required_fields = [
        'first_name', 'birth_date', 'sex', 'weight', 'height', 'bmi',
        'affected_right_knee', 'affected_left_knee', 
        'affected_right_hip', 'affected_left_hip', 'leg_dominance'
    ]
    
    missing = [field for field in required_fields if data.get(field) is None]
    if missing:
        return jsonify({"error": f"Campos obrigatórios ausentes: {', '.join(missing)}"}), 400

    try:
        user_info = {
            'first_name': data.get('first_name'), 
            'last_name': data.get('last_name', '')
        }
        
        user_id, email = create_manual_patient(user_info, data, doctor_id)
        
        return jsonify({
            "message": "Paciente registrado e vinculado com sucesso",
            "patient_id": user_id,
            "generated_email": email
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/patients/<patient_id>/sessions', methods=['POST'])
@token_required
def assign_patients_sessions(current_user, patient_id):
    if current_user['role'].lower() == 'doctor':
        doctor_id = current_user['id']
        relation = get_patient_doctor_relation(patient_id, doctor_id)
        if not relation:
            return jsonify({"error": "Patient not associated with this doctor"}), 403
        relation_id = relation['ID']
    elif current_user['role'].lower() == 'patient' and current_user['id'] == patient_id:
        relation = fetch_one(
            """
            SELECT pd.ID FROM patientdoctor pd
            WHERE pd.PatientID = :patient_id
            LIMIT 1
            """,
            {"patient_id": patient_id}
        )
        if not relation:
            return jsonify({"error": "Patient has no doctor relation"}), 403
        relation_id = relation['ID']
    else:
        return jsonify({"error": "Unauthorized"}), 403

    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    exercise_type = data.get('exercise_type') or data.get('exerciseType') or ""
    exercise_description = data.get('exercise_description') or data.get('exerciseDescription') or ""
    repetitions = data.get('repetitions')
    duration = data.get('duration')
    
    try:
        session_id = assign_session_to_patient(
            relation_id=relation_id,
            exercise_type=exercise_type,
            exercise_description=exercise_description,
            repetitions=repetitions,
            duration=duration
        )
        session = get_session_by_id(session_id)
        return jsonify(session or {"ID": session_id, "ExerciseType": exercise_type, "ExerciseDescription": exercise_description, "Repetitions": repetitions, "Duration": duration}), 201
    except Exception as e:
        return jsonify({"error": f"Failed to assign session: {str(e)}"}), 500

@app.route('/patients/<patient_id>/sessions', methods=['GET'])
@token_required
def get_patients_sessions(current_user, patient_id):
    try:
        sessions = get_patient_sessions(patient_id)
        
        if sessions is None:
            return jsonify({"message": "Nenhuma sessão encontrada"}), 404
            
        return jsonify(sessions), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route('/sessions/<session_id>', methods=['GET'])
@token_required
def get_session(current_user, session_id):
    session = get_session_by_id(session_id)

    if not session:
        return jsonify({"error": "Session not found"}), 404
    
    if current_user['role'].lower() == 'doctor':
        doctor_id = current_user['id']
        patient_id = session['PatientID'] 

        relation = get_patient_doctor_relation(patient_id, doctor_id)
    
        if not relation:
            return jsonify({"error": "Patient not associated with this doctor"}), 403
    
    return jsonify(session), 200

@app.route('/sessions/<session_id>', methods=['PUT'])
@token_required
def update_session(current_user, session_id):

    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403

    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    session = get_session_by_id(session_id)

    if not session:
        return jsonify({"error": "Session not found"}), 404
    
    if current_user['role'].lower() == 'doctor':
        doctor_id = current_user['id']
        patient_id = session['PatientID'] 

        relation = get_patient_doctor_relation(patient_id, doctor_id)
    
        if not relation:
            return jsonify({"error": "Patient not associated with this doctor"}), 403

    try:
        update_session_details(
            session_id=session_id,
            exercise_type=data.get('exercise_type'),
            exercise_description=data.get('exercise_description'),
            repetitions=data.get('repetitions'),
            duration=data.get('duration')
        )
        return jsonify({"message": "Session updated successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sessions/<session_id>', methods=['DELETE'])
@token_required
def delete_session(current_user, session_id):
    if current_user['role'].lower() != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403

    session = get_session_by_id(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    try:
        delete_patient_session(session_id)
        return jsonify({"message": "Session deleted successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sessions/<session_id>/metrics', methods=['POST'])
@token_required
def post_session_metrics(current_user, session_id):
    session = get_session_by_id(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    patient_id = session.get('PatientID')
    if current_user['role'].lower() == 'doctor':
        relation = get_patient_doctor_relation(patient_id, current_user['id'])
        if not relation:
            return jsonify({"error": "Patient not associated with this doctor"}), 403
    elif current_user['id'] != patient_id:
        return jsonify({"error": "Unauthorized"}), 403

    data = request.json or {}
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # Adapt frontend summary format to DB schema
    avg_rom = data.get('avg_rom') or data.get('AvgROM') or 0
    max_rom = data.get('max_rom') or data.get('MaxFlexion') or data.get('maxFlexion') or avg_rom
    min_rom = data.get('min_rom') or data.get('MaxExtension') or data.get('maxExtension') or 0
    repetition = int(data.get('repetition') or data.get('Repetitions') or data.get('repetitions') or 0)
    joint = str(data.get('joint') or 'knee')
    side = str(data.get('side') or 'both')
    min_v = float(data.get('min_velocity') or data.get('minVelocity') or 0)
    max_v = float(data.get('max_velocity') or data.get('maxVelocity') or 0)
    avg_v = float(data.get('avg_velocity') or data.get('avgVelocity') or 0)
    p95_v = float(data.get('p95_velocity') or data.get('p95Velocity') or 0)
    cmd = float(data.get('center_mass_displacement') or data.get('centerMassDisplacement') or data.get('cmd') or 0)

    adapted = {
        'joint': joint, 'side': side, 'repetition': repetition,
        'min_velocity': min_v, 'max_velocity': max_v, 'avg_velocity': avg_v, 'p95_velocity': p95_v,
        'min_rom': min_rom, 'max_rom': max_rom, 'avg_rom': avg_rom or 0,
        'center_mass_displacement': cmd
    }

    try:
        metric_id = insert_session_metrics(session_id, adapted)
        return jsonify({"message": "Metrics persisted", "id": metric_id}), 201
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[metrics] ERROR: {e}\n{tb}", flush=True)
        return jsonify({"error": str(e), "traceback": tb}), 500

@app.route('/patients/<patient_id>/metrics', methods=['GET'])
@token_required
def get_patient_metrics(current_user, patient_id):

    limit = min(request.args.get('limit', default=50, type=int), 50)
    
    try:
        metrics = get_metrics_by_patient(patient_id, limit)
        return jsonify(metrics), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sessions/<session_id>/metrics', methods=['GET'])
@token_required
def get_specific_session_metrics(current_user, session_id):

    session = get_session_by_id(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    try:
        metrics = get_metrics_by_session(session_id)
        
        if not metrics:
            return jsonify({"message": "No metrics found for this session"}), 404
            
        return jsonify(metrics), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/admin/fix-user-role', methods=['POST'])
@token_required
def fix_user_role(current_user):
    """
    Admin endpoint to fix a user's role.
    Allows users to fix their own role if they're currently a Patient.
    """
    data = request.get_json()
    email = data.get('email')
    new_role = data.get('role')
    
    if not email or not new_role:
        return jsonify({"error": "Email and role are required"}), 400
    
    if new_role not in ['Patient', 'Doctor']:
        return jsonify({"error": "Role must be 'Patient' or 'Doctor'"}), 400
    
    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500
    
    # Check if user exists
    user = fetch_one(
        """
        SELECT ID, Email, Role
        FROM users
        WHERE Email = :email
        """,
        {"email": email}
    )
    
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    # Allow users to fix their own role if they're currently a Patient
    # Or allow if the current user is a Doctor
    can_fix = (
        current_user['id'] == user['ID'] and user['Role'] == 'Patient'
    ) or current_user['role'].lower() == 'doctor'
    
    if not can_fix:
        return jsonify({"error": "Unauthorized to change this user's role"}), 403
    
    # Update the role
    try:
        execute(
            """
            UPDATE users
            SET Role = :role
            WHERE Email = :email
            """,
            {"role": new_role, "email": email}
        )
        
        return jsonify({
            "success": True,
            "message": f"User role updated to {new_role}",
            "email": email,
            "old_role": user['Role'],
            "new_role": new_role
        }), 200
    except Exception as e:
        return jsonify({"error": f"Failed to update role: {str(e)}"}), 500

@app.route('/exercise-types', methods=['GET'])
@token_required
def get_exercise_types(current_user):
    """Get all available exercise types."""
    try:
        # For now, return a default list of exercise types
        # TODO: Create exercise_types table and fetch from database
        exercise_types = [
            {
                "id": "knee_flexion",
                "name": "Knee Flexion",
                "description": "Flexion exercise for knee rehabilitation",
                "category": "knee",
                "targetReps": 10,
                "targetSets": 3,
            },
            {
                "id": "knee_extension",
                "name": "Knee Extension",
                "description": "Extension exercise for knee rehabilitation",
                "category": "knee",
                "targetReps": 10,
                "targetSets": 3,
            },
            {
                "id": "hip_flexion",
                "name": "Hip Flexion",
                "description": "Flexion exercise for hip rehabilitation",
                "category": "hip",
                "targetReps": 10,
                "targetSets": 3,
            },
            {
                "id": "hip_abduction",
                "name": "Hip Abduction",
                "description": "Abduction exercise for hip rehabilitation",
                "category": "hip",
                "targetReps": 10,
                "targetSets": 3,
            },
            {
                "id": "ankle_dorsiflexion",
                "name": "Ankle Dorsiflexion",
                "description": "Dorsiflexion exercise for ankle rehabilitation",
                "category": "ankle",
                "targetReps": 10,
                "targetSets": 3,
            },
            {
                "id": "general_walking",
                "name": "Walking",
                "description": "General walking exercise",
                "category": "general",
                "targetReps": None,
                "targetSets": None,
            },
        ]
        return jsonify(exercise_types)
    except Exception as e:
        import traceback
        return jsonify({"error": f"Error fetching exercise types: {str(e)}", "traceback": traceback.format_exc()}), 500

@app.route('/patients/<patient_id>/exercises', methods=['GET'])
@token_required
def get_patient_exercises(current_user, patient_id):
    """Get assigned exercises for a patient."""
    if current_user['role'].lower() != 'doctor' and current_user['id'] != patient_id:
        return jsonify({"error": "Unauthorized"}), 403
    
    if not is_db_enabled():
        return jsonify({"error": "Database not configured"}), 500
    
    try:
        # get_patient_sessions returns a list of session rows, not a dict
        sessions = get_patient_sessions(patient_id)
        if not sessions:
            return jsonify([])

        # Convert sessions to assigned exercises format (DB uses PascalCase keys)
        assigned_exercises = []
        for session in sessions:
            assigned_exercises.append({
                "id": session.get('ID', session.get('id', '')),
                "patientId": patient_id,
                "exerciseTypeId": session.get('ExerciseType', session.get('exerciseType', '')),
                "assignedDate": session.get('TimeCreated', session.get('timeCreated')),
                "completed": 0,
                "targetReps": session.get('Repetitions', session.get('repetitions')),
                "targetSets": None,
                "exerciseType": {
                    "id": session.get('ExerciseType', session.get('exerciseType', '')),
                    "name": session.get('ExerciseDescription', session.get('exerciseDescription', 'Exercise')),
                    "category": "general",
                }
            })

        return jsonify(assigned_exercises)
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500

@app.route('/patients/<patient_id>/exercises', methods=['POST'])
@token_required
def assign_patient_exercise(current_user, patient_id):
    """Assign an exercise to a patient."""
    try:
        if current_user['role'].lower() != 'doctor':
            return jsonify({"error": "Only doctors can assign exercises"}), 403
        
        if not is_db_enabled():
            return jsonify({"error": "Database not configured"}), 500
        
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        exercise_type_id = data.get('exercise_type_id')
        exercise_type_name = data.get('exercise_type_name') or data.get('exerciseTypeName')
        target_reps = data.get('target_reps')
        target_sets = data.get('target_sets')
        
        if not exercise_type_id:
            return jsonify({"error": "exercise_type_id is required"}), 400
        
        doctor_id = current_user['id']
        relation = get_patient_doctor_relation(patient_id, doctor_id)
        
        if not relation:
            return jsonify({"error": "Patient not associated with this doctor"}), 403
        
        relation_id = relation['ID']
        
        # Use provided name, or fall back to formatting the ID
        exercise_name = (exercise_type_name or "").strip() or exercise_type_id.replace('_', ' ').title()
        
        # Assign session (exercise) to patient
        assign_session_to_patient(
            relation_id=relation_id,
            exercise_type=exercise_type_id,
            exercise_description=exercise_name,
            repetitions=target_reps or 10,
            duration=None
        )
        
        return jsonify({"message": "Exercise assigned successfully"}), 201
    except Exception as e:
        import traceback
        return jsonify({"error": f"Error assigning exercise: {str(e)}", "traceback": traceback.format_exc()}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug) 

