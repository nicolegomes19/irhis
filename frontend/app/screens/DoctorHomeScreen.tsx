import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { usePatients } from '../context/PatientContext';
import { Ionicons } from '@expo/vector-icons';
import type { DoctorPatientItem } from '../services/doctorService';
import PatientCard from '@components/PatientCard';
import PendingInviteCard from '@components/PendingInviteCard';
import { useFocusEffect } from '@react-navigation/native';

interface StatCardProps {
    icon: keyof typeof Ionicons.glyphMap;
    value: string | number;
    label: string;
    color: string;
}

function formatMetricValue(metric: { avgROM?: number | null; avgVelocity?: number | null; [k: string]: unknown }): string {
    const rom = metric.avgROM ?? (metric as any).AvgROM;
    const vel = metric.avgVelocity ?? (metric as any).AvgVelocity;
    const romNum = typeof rom === 'number' ? rom : (typeof rom === 'string' ? parseFloat(rom) : NaN);
    const velNum = typeof vel === 'number' ? vel : (typeof vel === 'string' ? parseFloat(vel) : NaN);
    if (!Number.isNaN(romNum)) return `ROM: ${romNum.toFixed(1)}°`;
    if (!Number.isNaN(velNum)) return `Velocity: ${velNum.toFixed(2)}`;
    return '—';
}

const StatCard: React.FC<StatCardProps> = ({ icon, value, label, color }) => {
    const { colors } = useTheme();
    return (
        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <View style={[styles.iconContainer, { backgroundColor: color + '15' }]}>
                <Ionicons name={icon} size={24} color={color} />
            </View>
            <View>
                <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
            </View>
        </View>
    );
};

const DoctorHomeScreen = ({ navigation }: any) => {
    const { colors } = useTheme();
    const { user } = useAuth();
    const {
        doctorPatientsItems,
        dashboardKpis,
        latestFeedback,
        metricsSummary,
        recentActivity,
        trends,
        doctorDashboardError,
        patients,
        assignedExercises,
        fetchPatients,
        loading,
    } = usePatients();

    useFocusEffect(
        useCallback(() => {
            fetchPatients();
        }, [fetchPatients])
    );

    const pendingCount = doctorPatientsItems.filter((x) => x.type === 'pending').length;

    const renderHeader = () => (
        <>
            <View style={styles.header}>
                <View>
                    <Text style={[styles.welcomeText, { color: colors.textSecondary }]}>Welcome,</Text>
                    <Text style={[styles.title, { color: colors.text }]}>{user?.name}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity
                        style={[styles.addButton, { backgroundColor: colors.primary + '15' }]}
                        onPress={() => navigation.navigate('CreatePatient')}
                    >
                        <Ionicons name="person-add-outline" size={24} color={colors.primary} />
                    </TouchableOpacity>
                </View>
            </View>

            {dashboardKpis !== null && (
                <View style={styles.statsGrid}>
                    <StatCard
                        icon="people"
                        value={dashboardKpis.totalPatients}
                        label="Total Patients"
                        color={colors.purple[500]}
                    />
                    <StatCard
                        icon="fitness"
                        value={dashboardKpis.activePatients}
                        label="Active"
                        color={colors.success}
                    />
                    <StatCard
                        icon="trending-up"
                        value={
                            dashboardKpis.totalPatients > 0 &&
                            typeof dashboardKpis.avgProgress === "number" &&
                            !Number.isNaN(dashboardKpis.avgProgress)
                                ? `${Math.round(dashboardKpis.avgProgress)}%`
                                : "—"
                        }
                        label="Avg. Progress"
                        color={colors.warning}
                    />
                </View>
            )}

            {metricsSummary.length > 0 && (
                <View style={[styles.quickView, { backgroundColor: colors.card }]}>
                    <Text style={[styles.quickViewTitle, { color: colors.text }]}>Latest metrics</Text>
                    {metricsSummary.slice(0, 5).map((metric, idx) => (
                        <View key={idx} style={styles.quickViewRow}>
                            <Text style={[styles.quickViewName, { color: colors.text }]} numberOfLines={1}>{metric.patientName}</Text>
                            <Text style={[styles.quickViewMeta, { color: colors.textSecondary }]}>
                                {metric.joint} {metric.side ? `(${metric.side})` : ''} · {formatMetricValue(metric)}
                            </Text>
                            {metric.date ? <Text style={[styles.quickViewComment, { color: colors.textSecondary }]} numberOfLines={1}>
                                {new Date(metric.date).toLocaleDateString()}
                            </Text> : null}
                        </View>
                    ))}
                </View>
            )}

            {recentActivity.length > 0 && (
                <View style={[styles.quickView, { backgroundColor: colors.card }]}>
                    <Text style={[styles.quickViewTitle, { color: colors.text }]}>Recent activity</Text>
                    {recentActivity.slice(0, 5).map((activity, idx) => (
                        <View key={idx} style={styles.quickViewRow}>
                            <Text style={[styles.quickViewName, { color: colors.text }]} numberOfLines={1}>{activity.patientName}</Text>
                            <Text style={[styles.quickViewMeta, { color: colors.textSecondary }]}>
                                {activity.type === 'session' ? 'Session' : 'Feedback'} · {activity.label}
                            </Text>
                            {activity.date ? <Text style={[styles.quickViewComment, { color: colors.textSecondary }]} numberOfLines={1}>
                                {new Date(activity.date).toLocaleDateString()}
                            </Text> : null}
                        </View>
                    ))}
                </View>
            )}

            {trends !== null && (
                <View style={[styles.quickView, { backgroundColor: colors.card }]}>
                    <Text style={[styles.quickViewTitle, { color: colors.text }]}>Trends (last 30 days)</Text>
                    <View style={[styles.quickViewRow, { marginBottom: 4 }]}>
                        <Text style={[styles.quickViewMeta, { color: colors.textSecondary }]}>
                            Avg. Pain: {trends.avgPain.toFixed(1)}/10
                        </Text>
                    </View>
                    <View style={[styles.quickViewRow, { marginBottom: 4 }]}>
                        <Text style={[styles.quickViewMeta, { color: colors.textSecondary }]}>
                            Avg. Fatigue: {trends.avgFatigue.toFixed(1)}/10
                        </Text>
                    </View>
                    <View style={[styles.quickViewRow, { marginBottom: 0 }]}>
                        <Text style={[styles.quickViewMeta, { color: colors.textSecondary }]}>
                            Avg. Difficulty: {trends.avgDifficulty.toFixed(1)}/10
                        </Text>
                    </View>
                </View>
            )}

            {(() => {
                const confirmedPatients = doctorPatientsItems.filter((x) => x.type === 'patient');
                const patientsNeedingAttention = confirmedPatients.filter((item) => {
                    const patient = patients[item.id];
                    
                    const hasRecoveryProcess = !!(patient?.recovery_process && patient.recovery_process.length > 0);
                    
                    const hasAssignedExercises = !!(assignedExercises[item.id] && assignedExercises[item.id].length > 0);

                    return !hasRecoveryProcess && !hasAssignedExercises;
                });

                if (patientsNeedingAttention.length === 0) return null;

                return (
                    <View style={[styles.quickView, { backgroundColor: colors.card }]}>
                        <Text style={[styles.quickViewTitle, { color: colors.text }]}>Patients needing attention</Text>
                        {patientsNeedingAttention.slice(0, 5).map((item) => (
                            <View key={item.id} style={styles.quickViewRow}>
                                <Text style={[styles.quickViewName, { color: colors.text }]} numberOfLines={1}>
                                    {item.name}
                                </Text>
                                <Text style={[styles.quickViewMeta, { color: colors.textSecondary }]}>
                                    No exercises assigned
                                </Text>
                            </View>
                        ))}
                    </View>
                );
            })()}

            {latestFeedback.length > 0 && (
                <View style={[styles.quickView, { backgroundColor: colors.card }]}>
                    <Text style={[styles.quickViewTitle, { color: colors.text }]}>Latest feedback</Text>
                    {latestFeedback.slice(0, 5).map((fb) => (
                        <View key={fb.id} style={styles.quickViewRow}>
                            <Text style={[styles.quickViewName, { color: colors.text }]} numberOfLines={1}>{fb.patientName}</Text>
                            <Text style={[styles.quickViewMeta, { color: colors.textSecondary }]}>
                                Pain {fb.pain ?? '—'}/10 · Fatigue {fb.fatigue ?? '—'}/10 · Difficulty {fb.difficulty ?? '—'}/10
                            </Text>
                            {fb.comments ? <Text style={[styles.quickViewComment, { color: colors.textSecondary }]} numberOfLines={2}>{fb.comments}</Text> : null}
                        </View>
                    ))}
                </View>
            )}

            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Patient List</Text>
                <TouchableOpacity onPress={() => navigation.navigate('PatientList')} style={styles.tableLink}>
                    <Ionicons name="grid-outline" size={20} color={colors.primary} />
                    <Text style={[styles.tableLinkText, { color: colors.primary }]}>View table</Text>
                </TouchableOpacity>
            </View>
        </>
    );

    const renderItem = ({ item }: { item: DoctorPatientItem }) => {
        if (item.type === 'pending') {
            return <PendingInviteCard item={item} onPress={() => navigation.navigate('ManageInvites')} />;
        }
        const patient = patients[item.id];
        if (!patient) return null;
        return <PatientCard item={patient} navigation={navigation} />;
    };

    if (loading && doctorPatientsItems.length === 0 && !doctorDashboardError) {
        return (
            <View style={[styles.safeArea, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (doctorDashboardError) {
        return (
            <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
                <View style={[styles.errorContainer, { backgroundColor: colors.card }]}>
                    <Ionicons name="cloud-offline-outline" size={48} color={colors.textSecondary} />
                    <Text style={[styles.errorTitle, { color: colors.text }]}>Failed to load dashboard</Text>
                    <Text style={[styles.errorText, { color: colors.textSecondary }]}>{doctorDashboardError}</Text>
                    <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={() => fetchPatients()}>
                        <Text style={styles.retryButtonText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
            <FlatList
                data={doctorPatientsItems}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={renderHeader}
                contentContainerStyle={styles.contentContainer}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchPatients} colors={[colors.primary]} />}
                ListEmptyComponent={
                    <View style={[styles.emptyContainer, { backgroundColor: colors.card }]}>
                        <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>No patients assigned yet</Text>
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                            Patients will appear here once they are assigned to you.
                        </Text>
                    </View>
                }
            />
        </View>
    );
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        paddingTop: 0,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    welcomeText: {
        fontSize: 16,
        marginBottom: 4,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    addButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    badge: {
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
    quickView: { padding: 16, borderRadius: 12, marginBottom: 16 },
    quickViewTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
    quickViewRow: { marginBottom: 8 },
    quickViewName: { fontSize: 14, fontWeight: '600' },
    quickViewMeta: { fontSize: 12, marginTop: 2 },
    quickViewComment: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, margin: 16, borderRadius: 12 },
    errorTitle: { fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8, textAlign: 'center' },
    errorText: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
    retryButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
    retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 16,
    },
    statCard: {
        flex: 1,
        minWidth: '47%',
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statValue: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 14,
    },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    sectionTitle: { fontSize: 20, fontWeight: '600' },
    tableLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tableLinkText: { fontSize: 14, fontWeight: '600' },
    emptyContainer: {
        alignItems: 'center',
        padding: 32,
        borderRadius: 12,
        marginTop: 16,
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
        marginBottom: 24,
    },
    assignButton: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 24,
    },
    assignButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});

export default DoctorHomeScreen; 