import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiService, ApiResponse } from '../services/api';

// Define the MaintenanceRequest interface
interface MaintenanceRequest {
  id: number;
  ticketNumber: string;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: string;
}

const MaintenanceDetailScreen = ({ route }: any) => {
  const { requestId } = route.params;

  const { data: requestResponse, isLoading } = useQuery<ApiResponse<MaintenanceRequest[]>>({
    queryKey: ['maintenance-request', requestId],
    queryFn: async () => {
      const response = await apiService.getMaintenanceRequests();
      return response as ApiResponse<MaintenanceRequest[]>;
    },
  });

  // Mocking finding the specific request since api.ts doesn't have getById for maintenance yet
  const requests = requestResponse?.data || [];
  const request = requests.find((r: MaintenanceRequest) => r.id === requestId);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Text>Loading maintenance details...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Request #{request?.ticketNumber || requestId}</Text>
        <Text style={styles.subtitle}>{request?.category}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{request?.title || 'Details'}</Text>
        <Text>{request?.description || 'No description provided.'}</Text>
        <Text style={styles.status}>Status: {request?.status}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, backgroundColor: '#F59E0B' },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  subtitle: { fontSize: 16, color: '#E5E7EB' },
  section: { padding: 20, backgroundColor: 'white', margin: 16, borderRadius: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 10 },
  status: { marginTop: 10, fontWeight: 'bold', color: '#F59E0B' },
});

export default MaintenanceDetailScreen;
