import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import jwt as PyJWT

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as backend_app


class PatientResourceAuthTests(unittest.TestCase):
    def setUp(self):
        backend_app.app.config["TESTING"] = True
        self.client = backend_app.app.test_client()

    def auth_headers(self, user_id="patient-1"):
        token = PyJWT.encode(
            {"user_id": user_id},
            backend_app.app.config["SECRET_KEY"],
            algorithm="HS256",
        )
        return {"Authorization": f"Bearer {token}"}

    def user_record(self, user_id="patient-1", role=" Patient "):
        return {
            "ID": user_id,
            "Role": role,
            "Email": f"{user_id}@example.com",
            "FirstName": "Pat",
            "LastName": "One",
        }

    def test_patient_can_get_only_own_profile(self):
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "is_db_enabled", return_value=True), \
             patch.object(backend_app, "get_patient_by_id", return_value={
                 "ID": "patient-1",
                 "FirstName": "Pat",
                 "LastName": "One",
                 "Email": "patient-1@example.com",
                 "Sex": "female",
                 "Weight": 70,
                 "Height": 170,
                 "BMI": 24,
                 "MedicalHistory": "history",
             }), \
             patch.object(backend_app, "get_feedback_by_patient", return_value=[]):
            own_response = self.client.get(
                "/patients/patient-1",
                headers=self.auth_headers(),
            )

        self.assertEqual(own_response.status_code, 200)
        self.assertEqual(own_response.get_json()["id"], "patient-1")

        denied_lookup = Mock()
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_patient_by_id", denied_lookup):
            denied_response = self.client.get(
                "/patients/patient-2",
                headers=self.auth_headers(),
            )

        self.assertEqual(denied_response.status_code, 403)
        denied_lookup.assert_not_called()

    def test_patient_can_update_only_own_feedback(self):
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "is_db_enabled", return_value=True), \
             patch.object(backend_app, "insert_feedback") as insert_feedback, \
             patch.object(backend_app, "get_patient_by_id", return_value={
                 "FirstName": "Pat",
                 "LastName": "One",
             }), \
             patch.object(backend_app, "get_feedback_by_patient", return_value=[]):
            own_response = self.client.put(
                "/patients/patient-1/feedback",
                headers=self.auth_headers(),
                json={"feedback": {"pain": 2, "fatigue": 1, "difficulty": 3}},
            )

        self.assertEqual(own_response.status_code, 200)
        insert_feedback.assert_called_once()

        denied_insert = Mock()
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "insert_feedback", denied_insert):
            denied_response = self.client.put(
                "/patients/patient-2/feedback",
                headers=self.auth_headers(),
                json={"feedback": {"pain": 2}},
            )

        self.assertEqual(denied_response.status_code, 403)
        denied_insert.assert_not_called()

    def test_patient_can_get_only_own_sessions_collection(self):
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_patient_sessions", return_value=[{"ID": "session-1"}]):
            own_response = self.client.get(
                "/patients/patient-1/sessions",
                headers=self.auth_headers(),
            )

        self.assertEqual(own_response.status_code, 200)
        self.assertEqual(own_response.get_json()[0]["ID"], "session-1")

        denied_sessions = Mock()
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_patient_sessions", denied_sessions):
            denied_response = self.client.get(
                "/patients/patient-2/sessions",
                headers=self.auth_headers(),
            )

        self.assertEqual(denied_response.status_code, 403)
        denied_sessions.assert_not_called()

    def test_patient_can_get_only_own_session_resource(self):
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_session_by_id", return_value={
                 "ID": "session-1",
                 "PatientID": "patient-1",
             }):
            own_response = self.client.get(
                "/sessions/session-1",
                headers=self.auth_headers(),
            )

        self.assertEqual(own_response.status_code, 200)
        self.assertEqual(own_response.get_json()["PatientID"], "patient-1")

        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_session_by_id", return_value={
                 "ID": "session-2",
                 "PatientID": "patient-2",
             }):
            denied_response = self.client.get(
                "/sessions/session-2",
                headers=self.auth_headers(),
            )

        self.assertEqual(denied_response.status_code, 403)

    def test_patient_can_get_only_own_patient_metrics(self):
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_metrics_by_patient", return_value=[{"ID": "metric-1"}]):
            own_response = self.client.get(
                "/patients/patient-1/metrics",
                headers=self.auth_headers(),
            )

        self.assertEqual(own_response.status_code, 200)
        self.assertEqual(own_response.get_json()[0]["ID"], "metric-1")

        denied_metrics = Mock()
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_metrics_by_patient", denied_metrics):
            denied_response = self.client.get(
                "/patients/patient-2/metrics",
                headers=self.auth_headers(),
            )

        self.assertEqual(denied_response.status_code, 403)
        denied_metrics.assert_not_called()

    def test_patient_can_get_only_own_session_metrics(self):
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_session_by_id", return_value={
                 "ID": "session-1",
                 "PatientID": "patient-1",
             }), \
             patch.object(backend_app, "get_metrics_by_session", return_value=[{"ID": "metric-1"}]):
            own_response = self.client.get(
                "/sessions/session-1/metrics",
                headers=self.auth_headers(),
            )

        self.assertEqual(own_response.status_code, 200)
        self.assertEqual(own_response.get_json()[0]["ID"], "metric-1")

        denied_metrics = Mock()
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_session_by_id", return_value={
                 "ID": "session-2",
                 "PatientID": "patient-2",
             }), \
             patch.object(backend_app, "get_metrics_by_session", denied_metrics):
            denied_response = self.client.get(
                "/sessions/session-2/metrics",
                headers=self.auth_headers(),
            )

        self.assertEqual(denied_response.status_code, 403)
        denied_metrics.assert_not_called()

    def test_patient_can_post_metrics_only_for_own_session(self):
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_session_by_id", return_value={
                 "ID": "session-1",
                 "PatientID": "patient-1",
             }), \
             patch.object(backend_app, "insert_session_metrics", return_value="metric-1") as insert_metrics:
            own_response = self.client.post(
                "/sessions/session-1/metrics",
                headers=self.auth_headers(),
                json={"avg_rom": 10, "joint": "knee"},
            )

        self.assertEqual(own_response.status_code, 201)
        insert_metrics.assert_called_once()

        denied_insert = Mock()
        with patch.object(backend_app, "get_user_by_id", return_value=self.user_record()), \
             patch.object(backend_app, "get_session_by_id", return_value={
                 "ID": "session-2",
                 "PatientID": "patient-2",
             }), \
             patch.object(backend_app, "insert_session_metrics", denied_insert):
            denied_response = self.client.post(
                "/sessions/session-2/metrics",
                headers=self.auth_headers(),
                json={"avg_rom": 10, "joint": "knee"},
            )

        self.assertEqual(denied_response.status_code, 403)
        denied_insert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
