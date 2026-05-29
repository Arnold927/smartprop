import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Dimensions, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { LineChart } from 'react-native-chart-kit';

import { apiService, DashboardMetrics, RecentActivity, ApiResponse } from '../services/api';
import { useSync } from '../services/sync';
import MetricCard from '../components/MetricCard';
import QuickActionButton from '../components/QuickActionButton';

const { width: screenWidth } = Dimensions.get('window');

// Fix Icon component typing
const Icon = MaterialIcons as any;

const DashboardScreen = ({ navigation }: any) => {
  const { syncNow, lastSyncTime, pendingCount } = useSync();

  const { data: analyticsResponse, isLoading, refetch } = useQuery({
    queryKey: ['mobile-analytics'],
    queryFn: () => apiService.getDashboardMetrics(),
    refetchInterval: 30000,
  });

  const { data: recentActivityResponse } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: () => apiService.getMessages(),
    refetchInterval: 10000,
  });

  useEffect(() => { syncNow(); }, []);

  // Safe data extraction with proper typing
  const d = analyticsResponse?.data;
  const recentActivities: RecentActivity[] = (recentActivityResponse?.data?.activities ?? []) as RecentActivity[];
  const revenueLabels: string[] = d?.trends?.revenueLabels ?? [];
  const revenueValues: number[] = d?.trends?.revenue ?? [];

  const chartConfig = {
    backgroundColor: '#ffffff',
    backgroundGradientFrom: '#ffffff',
    backgroundGradientTo: '#ffffff',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(55, 65, 81, ${opacity})`,
    style: { borderRadius: 16 },
    propsForDots: { r: '4', strokeWidth: '2', stroke: '#3B82F6' },
  };

  const quickActions = [
    { title: 'New Inspection', icon: 'search', color: '#10B981', onPress: () => navigation.navigate('Inspections', { screen: 'NewInspection' }) },
    { title: 'Maintenance', icon: 'build', color: '#F59E0B', onPress: () => navigation.navigate('Maintenance') },
    { title: 'QR Scanner', icon: 'qr-code-scanner', color: '#8B5CF6', onPress: () => navigation.navigate('Security', { screen: 'QRScanner' }) },
    { title: 'Sync Data', icon: 'sync', color: '#3B82F6', onPress: () => syncNow() },
  ];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Smart Prop Mobile</Text>
        <Text style={styles.subtitle}>Real-time Property Management</Text>
        <View style={styles.syncStatus}>
          <Icon name="sync" size={16} color="#10B981" />
          <Text style={styles.syncText}>
            Last sync: {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : 'Never'}
          </Text>
          {pendingCount ? <Text style={styles.pendingCount}>({pendingCount} pending)</Text> : null}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.emptySubtitle}>Loading dashboard…</Text>
        </View>
      ) : !d ? (
        <View style={styles.centred}>
          <Icon name="cloud-off" size={48} color="#9CA3AF" />
          <Text style={styles.emptyTitle}>No data available</Text>
          <Text style={styles.emptySubtitle}>Pull down to refresh or check your connection.</Text>
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today's Overview</Text>
            <View style={styles.metricsGrid}>
              <MetricCard title="Properties" value={d.totalProperties ?? 0} icon="home" color="#3B82F6" />
              <MetricCard title="Inspections" value={d.activeInspections ?? 0} icon="search" color="#10B981" />
              <MetricCard title="Maintenance" value={d.pendingMaintenance ?? 0} icon="build" color="#F59E0B" />
              <MetricCard title="Visitors" value={d.todayVisitors ?? 0} icon="people" color="#8B5CF6" />
            </View>
          </View>

          {revenueValues.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Revenue Trend (KES)</Text>
              <View style={styles.chartContainer}>
                <LineChart
                  data={{
                    labels: revenueLabels,
                    datasets: [{ 
                      data: revenueValues, 
                      color: (o = 1) => `rgba(59,130,246,${o})`, 
                      strokeWidth: 3 
                    }],
                  }}
                  width={screenWidth - 40}
                  height={200}
                  chartConfig={chartConfig}
                  bezier
                  style={styles.chart}
                />
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActionsGrid}>
              {quickActions.map((a, i) => (
                <QuickActionButton key={i} title={a.title} icon={a.icon} color={a.color} onPress={a.onPress} />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {recentActivities.length === 0 ? (
              <Text style={styles.emptySubtitle}>No recent activity.</Text>
            ) : (
              <View style={styles.activityList}>
                {recentActivities.map((activity) => (
                  <View key={activity.id} style={styles.activityItem}>
                    <Icon
                      name={activity.type === 'inspection' ? 'search' : activity.type === 'maintenance' ? 'build' : 'people'}
                      size={20} 
                      color="#6B7280" 
                      style={styles.activityIcon}
                    />
                    <View style={styles.activityContent}>
                      <Text style={styles.activityMessage}>{activity.message}</Text>
                      <Text style={styles.activityTime}>{activity.time}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { backgroundColor: '#3B82F6', padding: 20, paddingTop: 50 },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#E5E7EB', marginBottom: 12 },
  syncStatus: { flexDirection: 'row', alignItems: 'center' },
  syncText: { color: '#E5E7EB', fontSize: 12, marginLeft: 4 },
  pendingCount: { color: '#FCD34D', fontSize: 12, marginLeft: 4 },
  centred: { alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#374151', marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: '#9CA3AF', marginTop: 4, textAlign: 'center' },
  section: {
    backgroundColor: 'white', 
    margin: 16, 
    padding: 20, 
    borderRadius: 12,
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, 
    shadowRadius: 4, 
    elevation: 3,
  },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1F2937', marginBottom: 16 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  chartContainer: { alignItems: 'center' },
  chart: { marginVertical: 8, borderRadius: 16 },
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  activityList: { gap: 12 },
  activityItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#F9FAFB', borderRadius: 8 },
  activityIcon: { marginRight: 12 },
  activityContent: { flex: 1 },
  activityMessage: { fontSize: 14, color: '#1F2937', fontWeight: '500' },
  activityTime: { fontSize: 12, color: '#6B7280', marginTop: 2 },
});

export default DashboardScreen;