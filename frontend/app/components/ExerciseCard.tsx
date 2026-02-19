import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTheme } from "@theme/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { AssignedExerciseWithDetails } from "@services/exerciseAssignmentService";
import { getSessionHistory } from "@services/sessionService";

interface ExerciseCardProps {
  exercise: AssignedExerciseWithDetails;
  patientId: string;
  onPress?: () => void;
  showProgress?: boolean;
}

const ExerciseCard: React.FC<ExerciseCardProps> = ({
  exercise,
  patientId,
  onPress,
  showProgress = true,
}) => {
  const { colors } = useTheme();
  const [completionRate, setCompletionRate] = React.useState(0);
  const [lastSessionDate, setLastSessionDate] = React.useState<string | null>(
    null
  );
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (showProgress) {
      loadProgress();
    } else {
      setLoading(false);
    }
  }, [exercise.id, patientId, showProgress]);

  const loadProgress = async () => {
    try {
      const sessions = await getSessionHistory(patientId, exercise.exerciseTypeId);
      
      if (sessions.length > 0) {
        // Calculate completion based on sessions vs target sets
        const targetSets = exercise.targetSets || 3;
        const completedSessions = sessions.length;
        const rate = Math.min(100, (completedSessions / targetSets) * 100);
        setCompletionRate(rate);
        
        // Get last session date
        const lastSession = sessions[0];
        if (lastSession) {
          const ts = (lastSession as any).startTime ?? (lastSession as any).timeCreated ?? lastSession.timeCreated;
          const date = new Date(ts);
          setLastSessionDate(isNaN(date.getTime()) ? null : date.toLocaleDateString());
        }
      } else {
        setCompletionRate(0);
      }
    } catch (error) {
      console.error("Error loading exercise progress:", error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "knee":
        return "body-outline";
      case "hip":
        return "fitness-outline";
      case "ankle":
        return "footsteps-outline";
      default:
        return "barbell-outline";
    }
  };

  const exerciseType = exercise.exerciseType;
  const category = exerciseType?.category || "general";
  const isCompleted = exercise.completed === 1;

  if (loading && showProgress) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading...
        </Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isCompleted ? colors.success : colors.mediumGray,
          borderWidth: isCompleted ? 2 : 1,
        },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.header}>
        <View style={styles.exerciseInfo}>
          <View
            style={[
              styles.iconContainer,
              {
                backgroundColor: isCompleted
                  ? colors.success + "15"
                  : colors.primary + "15",
              },
            ]}
          >
            <Ionicons
              name={getCategoryIcon(category) as any}
              size={24}
              color={isCompleted ? colors.success : colors.primary}
            />
          </View>
          <View style={styles.exerciseDetails}>
            <Text style={[styles.exerciseName, { color: colors.text }]}>
              {exerciseType?.name || "Unknown Exercise"}
            </Text>
            {exerciseType?.description && (
              <Text
                style={[
                  styles.exerciseDescription,
                  { color: colors.textSecondary },
                ]}
                numberOfLines={2}
              >
                {exerciseType.description}
              </Text>
            )}
          </View>
        </View>
        {isCompleted && (
          <View
            style={[
              styles.completedBadge,
              { backgroundColor: colors.success + "15" },
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          </View>
        )}
      </View>

      {showProgress && (
        <>
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text
                style={[styles.progressLabel, { color: colors.textSecondary }]}
              >
                Progress
              </Text>
              <Text style={[styles.progressValue, { color: colors.text }]}>
                {Math.round(completionRate)}%
              </Text>
            </View>
            <View
              style={[
                styles.progressBar,
                { backgroundColor: colors.gray[200] || colors.mediumGray },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: isCompleted
                      ? colors.success
                      : colors.primary,
                    width: `${completionRate}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.metricsRow}>
            {exercise.targetReps && (
              <View style={styles.metricBadge}>
                <Ionicons
                  name="repeat"
                  size={14}
                  color={colors.textSecondary}
                />
                <Text
                  style={[styles.metricText, { color: colors.textSecondary }]}
                >
                  {exercise.targetReps} reps
                </Text>
              </View>
            )}
            {exercise.targetSets && (
              <View style={styles.metricBadge}>
                <Ionicons
                  name="layers"
                  size={14}
                  color={colors.textSecondary}
                />
                <Text
                  style={[styles.metricText, { color: colors.textSecondary }]}
                >
                  {exercise.targetSets} sets
                </Text>
              </View>
            )}
            {lastSessionDate && (
              <View style={styles.metricBadge}>
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={colors.textSecondary}
                />
                <Text
                  style={[styles.metricText, { color: colors.textSecondary }]}
                >
                  {lastSessionDate}
                </Text>
              </View>
            )}
          </View>
        </>
      )}

      {!showProgress && (
        <View style={styles.metricsRow}>
          {exercise.targetReps && (
            <Text style={[styles.metricText, { color: colors.textSecondary }]}>
              {exercise.targetReps} reps
            </Text>
          )}
          {exercise.targetSets && (
            <Text style={[styles.metricText, { color: colors.textSecondary }]}>
              • {exercise.targetSets} sets
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  exerciseInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  exerciseDetails: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  exerciseDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  completedBadge: {
    padding: 4,
    borderRadius: 12,
  },
  progressSection: {
    marginTop: 8,
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  progressValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#E2E8F0",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  metricBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricText: {
    fontSize: 12,
  },
  loadingText: {
    fontSize: 14,
    textAlign: "center",
    padding: 8,
  },
});

export default ExerciseCard;

