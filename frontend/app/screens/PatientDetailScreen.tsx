import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RecoveryProcess, Patient, Medication, PatientDetails } from "../types";
import { useTheme } from "../theme/ThemeContext";
import AssignmentModal from "@components/AssignmentModal";
import PatientDetailsCard from "@components/PatientDetailsCard";
import MovementDataDisplay from "@components/MovementDataDisplay";
import Avatar from "@components/Avatar";
import { useHealth } from "@context/HealthContext";
import { usePatients } from "@context/PatientContext";
import { useAuth } from "@context/AuthContext";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import movementService from "@services/movementService";
import * as patientService from "@services/patientService";
import AssignedExercisesCard from "@components/AssignedExercisesCard";
import MovementAnalysisCard from "@components/MovementAnalysisCard";
import PatientFeedbackSection from "@components/PatientFeedbackSection";
import PatientProgressGraphs from "@components/PatientProgressGraphs";

const PatientDetailScreen = ({ route, navigation }: any) => {
  const { colors } = useTheme();
  const { patientId, role } = route.params;
  const { user } = useAuth();
  const {
    patients,
    updatePatient,
    assignPatient,
    assignedExercises,
    sessionsByPatient,
    fetchPatientSessions,
    fetchPatients,
  } = usePatients();
  const patientData = patients[patientId];
  const { healthData } = useHealth();

  // Refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchPatients();
      if (patientId) fetchPatientSessions(patientId);
    }, [patientId, fetchPatients, fetchPatientSessions])
  );

  const [exercises, setExercises] = useState<RecoveryProcess[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [assignmentType, setAssignmentType] = useState<
    "exercise" | "medication" | null
  >(null);
  const [selectedExercise, setSelectedExercise] =
    useState<RecoveryProcess | null>(null);
  const [movementData, setMovementData] = useState(
    patientData?.movementData?.[0]
  );

  const listFromContext = assignedExercises[patientId] ?? [];

  // Sessions (completed & assigned) for this patient, kept in context
  const sessionsForPatient = sessionsByPatient[patientId];
  const completedSessions = (sessionsForPatient?.completed ?? []).slice().sort(
    (a, b) =>
      new Date(b.timeCreated).getTime() - new Date(a.timeCreated).getTime()
  );

  useEffect(() => {
    if (patientData) {
      setMedications(patientData.medications || []);
    }
  }, [patientData]);

  useEffect(() => {
    if (listFromContext.length > 0) {
      setExercises(
        listFromContext.map((ex) => ({
          id: ex.id,
          name: (ex as any).exerciseType?.name ?? (ex as any).name ?? "Exercise",
          completed: ex.completed === 1,
          targetRepetitions: (ex as any).targetReps ?? 10,
          targetSets: (ex as any).targetSets ?? 3,
          instructions: "",
          assignedDate: (ex as any).timeCreated,
        }))
      );
    } else if (patientData?.recovery_process?.length) {
      setExercises(patientData.recovery_process);
    } else {
      setExercises([]);
    }
  }, [patientId, listFromContext, patientData?.recovery_process]);


  const handleToggleComplete = (
    id: string,
    type: "exercise" | "medication"
  ) => {
    if (role !== "patient") {
      return;
    }

    if (type === "exercise") {
      setExercises((current) =>
        current.map((ex) =>
          ex.id === id ? { ...ex, completed: !ex.completed } : ex
        )
      );
    } else {
      setMedications((current) =>
        current.map((med) =>
          med.id === id ? { ...med, completed: !med.completed } : med
        )
      );
    }
  };

  const openModal = (type: "exercise" | "medication") => {
    setAssignmentType(type);
    setModalVisible(true);
  };

  const handleAddAssignment = (name: string, dosage?: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3a24ed6e-2364-40cb-80fb-67e27d6c712f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PatientDetailScreen.tsx:141',message:'handleAddAssignment called',data:{assignmentType, name, dosage, patientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (assignmentType === "exercise") {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/3a24ed6e-2364-40cb-80fb-67e27d6c712f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PatientDetailScreen.tsx:143',message:'Creating exercise in local state only',data:{name, patientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const newExercise: RecoveryProcess = {
        id: `rp${Date.now()}`,
        name,
        completed: false,
        assignedDate: new Date().toISOString(),
      };
      setExercises((current) => [...current, newExercise]);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/3a24ed6e-2364-40cb-80fb-67e27d6c712f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PatientDetailScreen.tsx:149',message:'Exercise added to local state - NOT saved to assignedExercises table',data:{exerciseId:newExercise.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else if (assignmentType === "medication") {
      const newMedication: Medication = {
        id: `med${Date.now()}`,
        name,
        dosage: dosage || "",
        completed: false,
      };
      setMedications((current) => [...current, newMedication]);
    }
  };

  const handleUpdateDetails = async (details: Partial<PatientDetails>) => {
    if (!patientData) return;
    try {
      const payload = {
        age: details.age ?? 0,
        weight: details.weight ?? 0,
        height: details.height ?? 0,
        bmi: details.bmi ?? 0,
        sex: (details.sex ?? "").toString().toLowerCase(),
        clinicalInfo: details.clinicalInfo ?? "",
      };
      const updatedPatient = await patientService.updatePatientDetails(
        patientData.id,
        payload
      );
      updatePatient(patientData.id, updatedPatient);
      await fetchPatients();
      Alert.alert("Success", "Patient details updated successfully.");
    } catch (error: any) {
      console.error("Failed to update details:", error);
      const msg = error?.response?.data?.error || error?.response?.data?.message || error?.message || "Could not update patient details.";
      Alert.alert("Error", msg);
    }
  };

  const handleUploadMovementData = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/zip",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        const data = await movementService.processZipFile(result.assets[0].uri);
        if (
          data.jointPositions ||
          data.segmentOrientations ||
          data.gaitParameters
        ) {
          setMovementData({
            jointPositions: data.jointPositions || [],
            segmentOrientations: data.segmentOrientations || [],
            gaitParameters: data.gaitParameters || [],
            timestamp: new Date().toISOString(),
            exerciseId: selectedExercise?.id || "",
          });
        }
      }
    } catch (error) {
      console.error("Error uploading movement data:", error);
    }
  };

  const renderFeedbackItem = (feedback: any, index: number) => (
    <View
      key={index}
      style={[styles.feedbackItem, { backgroundColor: colors.card }]}
    >
      <View style={styles.feedbackHeader}>
        <Text style={[styles.feedbackDate, { color: colors.textSecondary }]}>
          {new Date(feedback.timestamp).toLocaleDateString()}
        </Text>
        <View style={styles.feedbackMetrics}>
          <View style={styles.metricItem}>
            <Ionicons name="bandage-outline" size={16} color={colors.primary} />
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {feedback.pain}/10
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Ionicons
              name="battery-half-outline"
              size={16}
              color={colors.primary}
            />
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {feedback.fatigue}/10
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Ionicons name="barbell-outline" size={16} color={colors.primary} />
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {feedback.difficulty}/10
            </Text>
          </View>
        </View>
      </View>
      {feedback.comments && (
        <Text
          style={[styles.feedbackComments, { color: colors.textSecondary }]}
        >
          {feedback.comments}
        </Text>
      )}
    </View>
  );

  const renderExerciseItem = ({ item }: { item: RecoveryProcess }) => (
    <TouchableOpacity
      style={styles.itemContainer}
      onPress={() => {
        if (role === "patient") {
          navigation.navigate("ExerciseDetail", { exercise: item });
        } else {
          setSelectedExercise(item);
        }
      }}
    >
      <Ionicons
        name={item.completed ? "checkmark-circle" : "ellipse-outline"}
        size={28}
        color={item.completed ? colors.primary : colors.textSecondary}
      />
      <View style={styles.exerciseInfo}>
        <Text
          style={
            item.completed
              ? [styles.itemTextCompleted, { color: colors.textSecondary }]
              : [styles.itemText, { color: colors.text }]
          }
        >
          {item.name}
        </Text>
        {item.assignedDate && (
          <Text style={[styles.assignedDate, { color: colors.textSecondary }]}>
            Assigned: {new Date(item.assignedDate).toLocaleDateString()}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderSessionItem = (session: import("../types").Session) => {
    const dateStr = session.timeCreated
      ? new Date(session.timeCreated).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "";

    const summaryParts: string[] = [];
    if (session.repetitions != null) {
      summaryParts.push(`${session.repetitions} reps`);
    }
    if (session.duration) {
      summaryParts.push(session.duration);
    }
    const summary = summaryParts.join(" • ") || "No metrics available";

    return (
      <TouchableOpacity
        key={session.id}
        style={[styles.sessionCard, { backgroundColor: colors.card }]}
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate("SessionDetail", {
            sessionId: session.id,
            patientId,
          })
        }
      >
        <View style={styles.sessionIcon}>
          <Ionicons name="barbell-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.sessionInfo}>
          <Text
            style={[styles.sessionTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {session.exerciseType || "Session"}
          </Text>
          <Text
            style={[styles.sessionDate, { color: colors.textSecondary }]}
          >
            {dateStr}
          </Text>
          <Text
            style={[styles.sessionSummary, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {summary}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
    );
  };

  // Load patient data if not in context
  useEffect(() => {
    if (patientId && !patientData) {
      patientService.getPatientById(patientId).then((patient) => {
        if (patient) updatePatient(patientId, patient);
      }).catch((error) => {
        console.error("Failed to load patient:", error);
      });
    }
  }, [patientId, patientData, updatePatient]);

  if (!patientData) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={styles.container}>
          <Text style={[styles.title, { color: colors.text }]}>
            Loading patient data...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Ensure details exists (create default if missing)
  const patientDetails = patientData.details || {
    age: 0,
    sex: 'Other' as const,
    height: 0,
    weight: 0,
    bmi: 0,
    clinicalInfo: 'No information provided.',
  };

  return (
    <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        <PatientDetailsCard
          details={patientDetails}
          onUpdateDetails={handleUpdateDetails}
          isEditable={role === "doctor"}
        />

        <AssignedExercisesCard
          patient={patientData}
          isEditable={role === "doctor"}
          navigation={navigation}
        />

        {/* Progress graphs based on sessions & metrics */}
        <PatientProgressGraphs patientId={patientId} />

        {/* Past Sessions */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Past Sessions
            </Text>
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("ExerciseHistory", {
                  patientId,
                })
              }
            >
              <Text
                style={[styles.viewAllText, { color: colors.primary }]}
              >
                View all
              </Text>
            </TouchableOpacity>
          </View>

          {completedSessions.length === 0 ? (
            <View style={styles.emptySessionContainer}>
              <Ionicons
                name="time-outline"
                size={32}
                color={colors.textSecondary}
              />
              <Text
                style={[styles.emptySessionTitle, { color: colors.text }]}
              >
                No sessions yet
              </Text>
              <Text
                style={[
                  styles.emptySessionText,
                  { color: colors.textSecondary },
                ]}
              >
                Once you record or upload movement data, sessions will appear
                here with metrics and feedback.
              </Text>
            </View>
          ) : (
            completedSessions.slice(0, 5).map(renderSessionItem)
          )}
        </View>

        {/* Patient Feedback & Progression Section - For Doctors and Patients viewing their own profile */}
        {(role === "doctor" || (role === "patient" && user?.id === patientId)) && (
          <PatientFeedbackSection patientId={patientId} />
        )}

        {patientData.feedback && patientData.feedback.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Patient Feedback
            </Text>
            {patientData.feedback
              .sort(
                (a, b) =>
                  new Date(b.timestamp).getTime() -
                  new Date(a.timestamp).getTime()
              )
              .map((feedback, index) => renderFeedbackItem(feedback, index))}
          </View>
        )}

        <MovementAnalysisCard patientId={patientData.id} />

        {selectedExercise && role === "doctor" && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Movement Data
              </Text>
              <TouchableOpacity onPress={handleUploadMovementData}>
                <Ionicons
                  name="cloud-upload-outline"
                  size={24}
                  color={colors.primary}
                />
              </TouchableOpacity>
            </View>
            {movementData ? (
              <>
                <MovementDataDisplay
                  jointPositions={movementData.jointPositions}
                  segmentOrientations={movementData.segmentOrientations}
                  gaitParameters={movementData.gaitParameters}
                />
              </>
            ) : (
              <Text
                style={[styles.noDataText, { color: colors.textSecondary }]}
              >
                Upload movement data to view analysis
              </Text>
            )}
          </View>
        )}

        {medications.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Medications
              </Text>
              {role === "doctor" && (
                <TouchableOpacity onPress={() => openModal("medication")}>
                  <Ionicons
                    name="add-circle-outline"
                    size={24}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={medications}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.itemContainer}
                  onPress={() =>
                    role === "patient" &&
                    handleToggleComplete(item.id, "medication")
                  }
                >
                  <Ionicons
                    name={
                      item.completed ? "checkmark-circle" : "ellipse-outline"
                    }
                    size={28}
                    color={
                      item.completed ? colors.primary : colors.textSecondary
                    }
                  />
                  <View>
                    <Text
                      style={
                        item.completed
                          ? [
                              styles.itemTextCompleted,
                              { color: colors.textSecondary },
                            ]
                          : [styles.itemText, { color: colors.text }]
                      }
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={[styles.dosage, { color: colors.textSecondary }]}
                    >
                      {item.dosage}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          </View>
        )}

      </ScrollView>

      {role === "doctor" && assignmentType && (
        <AssignmentModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          onSave={handleAddAssignment}
          assignmentType={assignmentType}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  title: {
    fontSize: 34,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: "500",
    marginBottom: 20,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressText: {
    fontSize: 16,
    marginBottom: 8,
    fontWeight: "600",
  },
  progressBarBackground: {
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
  },
  list: {
    marginTop: 10,
  },
  itemContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  itemText: {
    fontSize: 16,
    marginBottom: 4,
  },
  itemTextCompleted: {
    fontSize: 16,
    textDecorationLine: "line-through",
    marginBottom: 4,
  },
  assignedDate: {
    fontSize: 12,
  },
  itemDosage: {
    fontSize: 14,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  logButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginVertical: 20,
  },
  logButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  doctorActions: {
    marginVertical: 20,
    paddingHorizontal: 8,
  },
  actionButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 12,
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: "600",
    marginLeft: 10,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  exerciseInfo: {
    marginLeft: 12,
  },
  dosage: {
    fontSize: 14,
    marginTop: 2,
  },
  noDataText: {
    textAlign: "center",
    fontSize: 16,
    marginVertical: 20,
  },
  healthMetrics: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 8,
  },
  metric: {
    alignItems: "center",
  },
  healthMetricValue: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 8,
    marginBottom: 4,
  },
  healthMetricLabel: {
    fontSize: 14,
  },
  feedbackItem: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  feedbackHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  feedbackDate: {
    fontSize: 14,
    fontWeight: "500",
  },
  feedbackMetrics: {
    flexDirection: "row",
    gap: 16,
  },
  metricItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  feedbackComments: {
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 20,
  },
});

export default PatientDetailScreen;
