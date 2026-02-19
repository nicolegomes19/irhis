import React, { useEffect, useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@theme/ThemeContext';
import { useAuth } from '@context/AuthContext';
import { usePatients } from '@context/PatientContext';
import { useHealth } from '@context/HealthContext';
import { Ionicons } from '@expo/vector-icons';
import ActivityRings from '@components/ActivityRings';
import ChartCard from '@components/ChartCard';
import WeeklyFeedbackCard from '@components/WeeklyFeedbackCard';
import ExerciseCard from '@components/ExerciseCard';

const PatientHomeScreen = ({ navigation }: any) => {
    const { colors } = useTheme();
    const { user } = useAuth();
    const { patients, assignedExercises, loading, patientDashboardError, fetchAssignedExercises, fetchPatients } = usePatients();
    const { healthData, dailyData, isConnected, isLoading, connectDevice, refreshHealthData } = useHealth();
    const patient = user ? patients[user.id] : null;
    const exercises = user ? (assignedExercises[user.id] || []) : [];

    const [refreshing, setRefreshing] = useState(false);

    const refreshDashboard = useCallback(async () => {
        if (!user?.id) return;
        setRefreshing(true);
        try {
            await fetchPatients();
            if (refreshHealthData) refreshHealthData();
        } finally {
            setRefreshing(false);
        }
    }, [user?.id, fetchPatients, refreshHealthData]);

    // Removed useFocusEffect - it was causing race with PatientContext's useEffect.
    // Data loads via PatientContext when user is set; use pull-to-refresh to refresh.

    // Debug logging
    useEffect(() => {
        console.log('Current user:', user);
        console.log('All patients:', patients);
        console.log('Current patient:', patient);
        console.log('Assigned exercises:', exercises);
    }, [user, patients, patient, exercises]);

    if (!patient) {
        if (patientDashboardError) {
            return (
                <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
                    <View style={[styles.container, styles.errorContainer]}>
                        <Ionicons name="cloud-offline-outline" size={48} color={colors.textSecondary} />
                        <Text style={[styles.errorTitle, { color: colors.text }]}>Failed to load dashboard</Text>
                        <Text style={[styles.errorText, { color: colors.textSecondary }]}>{patientDashboardError}</Text>
                        <TouchableOpacity
                            style={[styles.retryButton, { backgroundColor: colors.primary }]}
                            onPress={() => refreshDashboard()}
                        >
                            <Text style={styles.retryButtonText}>Try again</Text>
                        </TouchableOpacity>
                    </View>
                </SafeAreaView>
            );
        }
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
                <View style={styles.container}>
                    <Text style={[styles.title, { color: colors.text }]}>
                        {loading ? 'Loading...' : 'Loading dashboard...'}
                    </Text>
                    {!loading && (
                        <TouchableOpacity
                            style={[styles.retryButton, { backgroundColor: colors.primary, marginTop: 16 }]}
                            onPress={() => fetchPatients()}
                        >
                            <Text style={styles.retryButtonText}>Retry</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </SafeAreaView>
        );
    }

    const assignedList = exercises.filter((ex: any) => ex.completed !== 1);
    const completedList = exercises.filter((ex: any) => ex.completed === 1);
    const completedExercises = completedList.length;
    const totalExercises = exercises.length;

    const activityData = {
        move: {
            goal: dailyData?.goals.calories || 400,
            current: dailyData?.calories || 0,
        },
        exercise: {
            goal: dailyData?.goals.activeMinutes || 30,
            current: dailyData?.activeMinutes || 0,
        },
        stand: {
            goal: 12,
            current: Math.round((dailyData?.activeMinutes || 0) / 60) || 0,
        },
    };

    const handleWeeklyFeedbackSubmit = async (feedback: any) => {
        try {
            console.log('Submitting feedback for user:', user?.id);
            console.log('Patient data:', patient);
            
            if (!user?.id) {
                console.error('No user ID available');
                return;
            }

            const newFeedback = {
                ...feedback,
                sessionId: `weekly_${Date.now()}`,
                timestamp: new Date().toISOString(),
            };

            // Note: This would need to be updated to use local storage
            // For now, we'll just log it
            console.log('Feedback submitted:', newFeedback);
        } catch (error) {
            console.error('Failed to submit weekly feedback:', error);
        }
    };

    const renderExerciseItem = ({ item }: { item: any }) => (
        <ExerciseCard
            exercise={item}
            patientId={user?.id || ''}
            onPress={() => navigation.navigate('Live Session')}
            showProgress={true}
        />
    );

    return (
        // Use only bottom safe area, the top is already handled by the navigation header
        <SafeAreaView
            style={[styles.safeArea, { backgroundColor: colors.background }]}
            edges={['bottom']}
        >
            <ScrollView
                style={styles.container}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={refreshDashboard}
                        tintColor={colors.primary}
                    />
                }
            >
                <View style={styles.header}>
                    <View>
                        <Text style={[styles.welcomeText, { color: colors.textSecondary }]}>Welcome back,</Text>
                        <Text style={[styles.title, { color: colors.text }]}>{patient.name}</Text>
                    </View>
                    {/* Botão Connect Watch removido conforme ticket IRHIS-18 */}
                    <TouchableOpacity 
                        style={[styles.refreshButton, { backgroundColor: colors.card }]}
                        onPress={refreshDashboard}
                        disabled={refreshing || isLoading}
                    >
                        <Ionicons 
                            name={refreshing || isLoading ? "sync" : "refresh-outline"} 
                            size={24} 
                            color={colors.text} 
                        />
                    </TouchableOpacity>
                </View>

                <View style={[styles.progressCard, { backgroundColor: colors.primary, marginBottom: 20 }]}>
                    {/* <ActivityRings data={activityData} size={180} /> */}
                    <View style={styles.progressInfo}>
                        <Text style={[styles.progressTitle, { color: "#FFF" }]}>Today's Progress</Text>
                        <Text style={[styles.progressText, { color: "rgba(255,255,255,0.9)" }]}>
                        {`${completedExercises} of ${totalExercises} exercises completed`}
                        </Text>
                    </View>
                </View>

                {/*
                {isConnected && healthData && (
                <View style={styles.statsGrid}>
                    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                    <View style={[styles.statIcon, { backgroundColor: colors.primary + '15' }]}>
                        <Ionicons name="walk-outline" size={24} color={colors.primary} />
                    </View>
                    <Text style={[styles.statValue, { color: colors.text }]}>
                        {healthData.steps.toLocaleString()}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Steps</Text>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIcon, { backgroundColor: colors.success + '15' }]}>
                        <Ionicons name="flame-outline" size={24} color={colors.success} />
                    </View>
                    <Text style={[styles.statValue, { color: colors.text }]}>
                        {healthData.calories}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Calories</Text>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                    <View style={[styles.statIcon, { backgroundColor: colors.info + '15' }]}>
                        <Ionicons name="heart-outline" size={24} color={colors.info} />
                    </View>
                    <Text style={[styles.statValue, { color: colors.text }]}>
                        {healthData.heartRate?.current || '--'}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>BPM</Text>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIcon, { backgroundColor: colors.warning + '15' }]}>
                        <Ionicons name="walk-outline" size={24} color={colors.warning} />
                    </View>
                    <Text style={[styles.statValue, { color: colors.text }]}>
                        {(healthData.distance / 1000).toFixed(1)}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>KM</Text>
                    </View>
                </View>
                ))}
                */}


                <WeeklyFeedbackCard onSubmit={handleWeeklyFeedbackSubmit} />

                <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Exercises</Text>
                {assignedList.length > 0 ? (
                    <>
                        <Text style={[styles.subsectionTitle, { color: colors.textSecondary }]}>Assigned</Text>
                        <FlatList
                            data={assignedList}
                            renderItem={renderExerciseItem}
                            keyExtractor={(item: any) => item.id}
                            contentContainerStyle={styles.exerciseList}
                            scrollEnabled={false}
                        />
                    </>
                ) : null}
                {completedList.length > 0 ? (
                    <>
                        <Text style={[styles.subsectionTitle, { color: colors.textSecondary }]}>Completed</Text>
                        <FlatList
                            data={completedList}
                            renderItem={renderExerciseItem}
                            keyExtractor={(item: any) => item.id}
                            contentContainerStyle={styles.exerciseList}
                            scrollEnabled={false}
                        />
                        <TouchableOpacity
                            style={[styles.historyLink, { borderColor: colors.primary }]}
                            onPress={() => navigation.navigate('History')}
                        >
                            <Ionicons name="time-outline" size={20} color={colors.primary} />
                            <Text style={[styles.historyLinkText, { color: colors.primary }]}>View full history</Text>
                        </TouchableOpacity>
                    </>
                ) : null}
                {assignedList.length === 0 && completedList.length === 0 ? (
                    <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
                        <Ionicons name="fitness-outline" size={48} color={colors.textSecondary} />
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>
                            No Exercises Assigned
                        </Text>
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                            Your doctor will assign exercises for you to complete.
                        </Text>
                    </View>
                ) : null}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    container: {
        flex: 1,
        padding: 16,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    errorTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    errorText: {
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 24,
    },
    retryButton: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
    },
    retryButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    welcomeText: {
        fontSize: 16,
        marginBottom: 4,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    connectButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
    },
    connectButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    refreshButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    progressCard: {
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    progressInfo: {
        gap: 1,
    },
    progressTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
        textAlign: 'center',
    },
    progressText: {
        fontSize: 14,
        textAlign: 'center',
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 24,
    },
    statCard: {
        flex: 1,
        minWidth: '45%',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
    },
    statIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 14,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 16,
    },
    subsectionTitle: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 8,
        marginTop: 8,
    },
    exerciseList: {
        gap: 12,
    },
    historyLink: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        marginTop: 12,
        borderRadius: 8,
        borderWidth: 1,
    },
    historyLinkText: {
        fontSize: 14,
        fontWeight: '600',
    },
    exerciseCard: {
        borderRadius: 12,
        overflow: 'hidden',
    },
    exerciseContent: {
        padding: 16,
    },
    exerciseHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    exerciseInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    exerciseIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    exerciseName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    exerciseStatus: {
        fontSize: 14,
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    statusText: {
        fontSize: 14,
        fontWeight: '600',
    },
    startButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderRadius: 8,
        gap: 8,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    emptyState: {
        borderRadius: 12,
        padding: 32,
        alignItems: 'center',
        marginTop: 8,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 14,
        textAlign: 'center',
        color: '#6B7280', // textSecondary color
    },
});

export default PatientHomeScreen; 