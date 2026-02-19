import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Modal,
  Platform,
  ToastAndroid,
  InteractionManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@theme/ThemeContext";
import { useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  MovellaBleService,
  MovellaSensor,
  DeviceTag,
  FusionMeasurementData,
  PayloadMode,
  getMovellaBleService,
} from "@services/movellaBleService";
import { convertBleDataToZip, createCSVForSensor } from "@services/bleDataConverter";
import { createLocalAnalysisApi, AnalysisResult } from "@services/analysisApi";
import { createSessionFromAnalysisResult } from "@services/sessionService";
import { useAuth } from "@context/AuthContext";
import { usePatients } from "@context/PatientContext";
import ErrorBoundary from "@components/ErrorBoundary";
import LocalAnalysisResults from "@components/LocalAnalysisResults";

interface BleConnectionScreenProps {
  navigation?: any;
  onSensorsConnected?: (sensorIds: string[]) => void;
}

const BleConnectionScreen: React.FC<BleConnectionScreenProps> = ({
  navigation: _navigation,
  onSensorsConnected,
}) => {
  const { colors } = useTheme();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { fetchPatients, fetchAssignedExercises } = usePatients();
  const params = route.params ?? {};
  const [bleService] = useState<MovellaBleService>(getMovellaBleService());
  const [sensors, setSensors] = useState<MovellaSensor[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<Set<string>>(new Set());
  
  // Exercise state
  const [isExerciseActive, setIsExerciseActive] = useState(false);
  const [exerciseData, setExerciseData] = useState<Map<string, FusionMeasurementData[]>>(new Map());
  const [exerciseStartTime, setExerciseStartTime] = useState<Date | null>(null);
  const [packetCounters, setPacketCounters] = useState<Map<string, number>>(new Map());
  const [canAnalyze, setCanAnalyze] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [bleAnalysisResult, setBleAnalysisResult] = useState<AnalysisResult | null>(null);
  
  // Testing Mode and Real-time Logs
  const [testingMode, setTestingMode] = useState(false);
  const [realTimeLogs, setRealTimeLogs] = useState<Array<{
    timestamp: string;
    sensorId: string;
    sensorName: string;
    deviceTag: string;
    packetCounter: number;
    euler: { x: number; y: number; z: number };
    freeAcc: { x: number; y: number; z: number };
  }>>([]);
  const logsScrollViewRef = useRef<ScrollView>(null);
  const noDataWarningShownRef = useRef(false);

  // CSV Modal state
  const [csvModalVisible, setCsvModalVisible] = useState(false);
  const [csvModalContent, setCsvModalContent] = useState<string | null>(null);
  const [csvModalSensorName, setCsvModalSensorName] = useState<string>("");
  
  // Collapsible sections state
  const [sensorsSectionCollapsed, setSensorsSectionCollapsed] = useState(false);
  const [exerciseSectionCollapsed, setExerciseSectionCollapsed] = useState(false);
  const [analysisSectionCollapsed, setAnalysisSectionCollapsed] = useState(true);
  
  // Use refs for callback data to avoid closure issues
  const firstTimestampsRef = useRef<Map<string, number>>(new Map());
  const exerciseDataRef = useRef<Map<string, FusionMeasurementData[]>>(new Map());
  const isExerciseActiveRef = useRef(false);

  // Defer BLE callbacks to next JS tick to avoid Android crash (state updates from native BLE context)
  const defer = (fn: () => void) => {
    if (Platform.OS === "android") {
      setTimeout(fn, 0);
    } else {
      fn();
    }
  };

  useEffect(() => {
    // Setup callbacks
    bleService.setCallbacks({
      onSensorDiscovered: (sensor) => {
        defer(() => {
          setSensors((prev) => {
            const exists = prev.find((s) => s.id === sensor.id);
            if (exists) return prev;
            return [...prev, sensor];
          });
        });
      },
      onSensorConnected: (sensorId) => {
        defer(() => {
          setConnecting((prev) => {
            const next = new Set(prev);
            next.delete(sensorId);
            return next;
          });
          updateSensorList();
          checkAllConnected();
        });
      },
      onSensorDisconnected: () => {
        defer(updateSensorList);
      },
      onBatteryLevel: () => {
        defer(updateSensorList);
      },
      onFusionMeasurementData: (sensorId, data) => {
        console.log(`📥 [UI] onFusionMeasurementData callback invoked for ${sensorId}`);
        console.log(`📥 [UI] Data received: PacketCounter=${data.PacketCounter}, SampleTimeFine=${data.SampleTimeFine}, Euler=[${data.Euler_X.toFixed(2)}, ${data.Euler_Y.toFixed(2)}, ${data.Euler_Z.toFixed(2)}]`);
        
        if (isExerciseActiveRef.current) {
          // Get sensor info for logging - need to get from service since sensors state might be stale
          const allSensors = bleService.getSensors();
          const sensor = allSensors.find(s => s.id === sensorId);
          const sensorName = sensor?.name || `Sensor ${sensorId.substring(0, 8)}`;
          const deviceTagName = sensor?.deviceTag ? getDeviceTagName(sensor.deviceTag) : "Not assigned";
          
          console.log(`📥 [UI] Processing data for ${sensorName} (${deviceTagName})`);
          
          // Get or set first timestamp for this sensor
          let firstTimestamp = firstTimestampsRef.current.get(sensorId);
          if (!firstTimestamp) {
            firstTimestamp = data.SampleTimeFine;
            firstTimestampsRef.current.set(sensorId, firstTimestamp);
            console.log(`📥 [UI] First timestamp for ${sensorId}: ${firstTimestamp}`);
          }
          
          // Add packet counter and adjust SampleTimeFine relative to first timestamp
          const currentData = exerciseDataRef.current.get(sensorId) || [];
          const counter = currentData.length + 1;
          const relativeTime = data.SampleTimeFine - firstTimestamp;
          
          console.log(`📥 [UI] Packet counter: ${counter}, relative time: ${relativeTime}`);
          
          const adjustedData: FusionMeasurementData = {
            ...data,
            PacketCounter: counter,
            SampleTimeFine: relativeTime,
          };
          
          // Update ref
          const newMap = new Map(exerciseDataRef.current);
          newMap.set(sensorId, [...currentData, adjustedData]);
          exerciseDataRef.current = newMap;
          
          // Update state
          setExerciseData(newMap);
          setPacketCounters((prev) => {
            const newMap = new Map(prev);
            newMap.set(sensorId, counter);
            return newMap;
          });
          
          console.log(`📥 [UI] Updated exerciseDataRef, total packets for ${sensorId}: ${counter}`);
          
          // Add to real-time logs (limit to 100 entries)
          const now = new Date();
          const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
          
          setRealTimeLogs((prevLogs) => {
            const newLogs = [...prevLogs, {
              timestamp,
              sensorId,
              sensorName,
              deviceTag: deviceTagName,
              packetCounter: counter,
              euler: {
                x: data.Euler_X,
                y: data.Euler_Y,
                z: data.Euler_Z,
              },
              freeAcc: {
                x: data.FreeAcc_X,
                y: data.FreeAcc_Y,
                z: data.FreeAcc_Z,
              },
            }];
            
            // Keep only last 100 entries
            return newLogs.slice(-100);
          });
          
          // Auto-scroll to bottom
          setTimeout(() => {
            logsScrollViewRef.current?.scrollToEnd({ animated: true });
          }, 100);
          
          // Reset no data warning flag
          noDataWarningShownRef.current = false;
        } else {
          console.warn(`⚠️ [UI] Received data but exercise is not active (isExerciseActiveRef.current=${isExerciseActiveRef.current})`);
        }
      },
      onError: (error) => {
        Alert.alert("BLE Error", error.message);
      },
    });

    // Load existing sensors
    updateSensorList();

    return () => {
      // Cleanup
      bleService.stopScanning().catch(console.error);
      if (isExerciseActive) {
        // Stop measurements sequentially on unmount (Android BLE struggles with concurrent ops)
        const connectedSensors = bleService.getConnectedSensors();
        const stopSequentially = async () => {
          for (let i = 0; i < connectedSensors.length; i++) {
            try {
              await bleService.stopMeasurement(connectedSensors[i].id);
            } catch (e) {
              console.error(e);
            }
            if (Platform.OS === "android" && i < connectedSensors.length - 1) {
              await new Promise((r) => setTimeout(r, 150));
            }
          }
        };
        stopSequentially();
      }
    };
  }, [bleService]);

  const updateSensorList = useCallback(() => {
    const allSensors = bleService.getSensors();
    setSensors(allSensors);
  }, [bleService]);

  const checkAllConnected = useCallback(() => {
    const connected = bleService.getConnectedSensors();
    if (connected.length > 0 && onSensorsConnected) {
      onSensorsConnected(connected.map((s) => s.id));
    }
  }, [bleService, onSensorsConnected]);

  // Check if all required sensors are connected (5 in normal mode, 1+ in testing mode)
  const hasAllSensorsConnected = useCallback((testMode: boolean = false): boolean => {
    const connected = bleService.getConnectedSensors();
    
    if (testMode) {
      // Testing mode: require at least 1 connected sensor
      return connected.length >= 1;
    }
    
    // Normal mode: require all 5 sensors with DeviceTags 1-5
    if (connected.length < 5) return false;
    
    // Check if we have all DeviceTags 1-5
    const deviceTags = new Set<DeviceTag>();
    connected.forEach((sensor) => {
      if (sensor.deviceTag) {
        deviceTags.add(sensor.deviceTag);
      }
    });
    
    return deviceTags.has(DeviceTag.RIGHT_THIGH) &&
           deviceTags.has(DeviceTag.RIGHT_SHANK) &&
           deviceTags.has(DeviceTag.LEFT_THIGH) &&
           deviceTags.has(DeviceTag.LEFT_SHANK) &&
           deviceTags.has(DeviceTag.PELVIS);
  }, [bleService]);

  const handleStartExercise = async () => {
    console.log(`🎬 [UI] handleStartExercise() called, testingMode: ${testingMode}`);
    
    if (!hasAllSensorsConnected(testingMode)) {
      if (testingMode) {
        Alert.alert(
          "Sensors Required",
          "Please connect at least 1 sensor before starting exercise."
        );
      } else {
        Alert.alert(
          "Sensors Required",
          "Please connect all 5 sensors (Right thigh, Right shank, Left thigh, Left shank, Pelvis) before starting exercise."
        );
      }
      return;
    }

    try {
      const connectedSensors = bleService.getConnectedSensors();
      console.log(`🎬 [UI] Starting exercise with ${connectedSensors.length} sensors`);
      console.log(`🎬 [UI] Sensors: ${connectedSensors.map(s => `${s.name || s.id.substring(0, 8)} (${getDeviceTagName(s.deviceTag)})`).join(', ')}`);
      console.log(`🎬 [UI] Payload mode: ${PayloadMode.EXTENDED_QUATERNION} (EXTENDED_QUATERNION)`);
      
      // Initialize exercise state
      const startTime = new Date();
      setExerciseStartTime(startTime);
      setExerciseData(new Map());
      exerciseDataRef.current = new Map();
      firstTimestampsRef.current = new Map();
      setPacketCounters(new Map());
      setRealTimeLogs([]);
      noDataWarningShownRef.current = false;
      setIsExerciseActive(true);
      isExerciseActiveRef.current = true;
      setCanAnalyze(false);
      setBleAnalysisResult(null);
      
      console.log(`🎬 [UI] Exercise state initialized, startTime: ${startTime.toISOString()}`);
      
      // Start measurement on sensors sequentially (Android BLE stack struggles with concurrent requests)
      for (let i = 0; i < connectedSensors.length; i++) {
        const sensor = connectedSensors[i];
        console.log(`🎬 [UI] Starting measurement on sensor: ${sensor.name || sensor.id.substring(0, 8)}`);
        await bleService.startMeasurement(sensor.id, PayloadMode.EXTENDED_QUATERNION);
        if (Platform.OS === "android" && i < connectedSensors.length - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      console.log(`🎬 [UI] All startMeasurement completed`);
      
      // Set timeout to warn if no data received after 5 seconds
      setTimeout(() => {
        if (isExerciseActiveRef.current && exerciseDataRef.current.size === 0 && !noDataWarningShownRef.current) {
          console.warn(`⚠️ [UI] No data received after 5 seconds!`);
          console.warn(`⚠️ [UI] exerciseDataRef.size: ${exerciseDataRef.current.size}`);
          console.warn(`⚠️ [UI] isExerciseActiveRef.current: ${isExerciseActiveRef.current}`);
          Alert.alert(
            "No Data Received",
            "No measurement data has been received from sensors. Please check sensor connections and try again."
          );
          noDataWarningShownRef.current = true;
        }
      }, 5000);
      
      Alert.alert("Exercise Started", "Recording data from all sensors...");
    } catch (error) {
      console.error("❌ [UI] Error starting exercise:", error);
      console.error("❌ [UI] Error details:", error instanceof Error ? error.stack : String(error));
      Alert.alert("Error", `Failed to start exercise: ${error instanceof Error ? error.message : String(error)}`);
      setIsExerciseActive(false);
      isExerciseActiveRef.current = false;
    }
  };

  const handleStopExercise = async () => {
    // Stop processing BLE data immediately to avoid race with subscription removal
    setIsExerciseActive(false);
    isExerciseActiveRef.current = false;
    const sensorCount = exerciseDataRef.current.size;

    const doStop = async () => {
      try {
        const connectedSensors = bleService.getConnectedSensors();
        // Sequential loop instead of Promise.all (Android BLE stack struggles with concurrent requests)
        for (let i = 0; i < connectedSensors.length; i++) {
          await bleService.stopMeasurement(connectedSensors[i].id);
          if (Platform.OS === "android" && i < connectedSensors.length - 1) {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      } catch (error) {
        console.error("Error stopping exercise:", error);
        Alert.alert("Error", `Failed to stop exercise: ${error instanceof Error ? error.message : String(error)}`);
      }
      setCanAnalyze(sensorCount > 0);
      if (Platform.OS === "android") {
        try {
          ToastAndroid.show(sensorCount > 0 ? "Exercise stopped. You can analyze." : "No data recorded.", ToastAndroid.SHORT);
        } catch (_) { /* ignore */ }
      } else {
        Alert.alert(
          "Exercise Stopped",
          sensorCount > 0
            ? `Recorded data from ${sensorCount} sensor${sensorCount !== 1 ? "s" : ""}. You can now analyze.`
            : "No data was recorded."
        );
      }
    };

    if (Platform.OS === "android") {
      setTimeout(() => doStop(), 50);
    } else {
      await doStop();
    }
  };

  const handleClearLogs = () => {
    setRealTimeLogs([]);
  };

  const handleAnalyzeExercise = async () => {
    if (isAnalyzing) return;
    console.log("🔬 [UI] handleAnalyzeExercise() called");
    console.log("🔬 [UI] exerciseStartTime:", exerciseStartTime);
    console.log("🔬 [UI] exerciseDataRef.current.size:", exerciseDataRef.current.size);
    console.log("🔬 [UI] exerciseDataRef.current keys:", Array.from(exerciseDataRef.current.keys()));
    
    if (!exerciseStartTime || exerciseDataRef.current.size === 0) {
      console.error("❌ [UI] No data to analyze - exerciseStartTime or exerciseDataRef is empty");
      Alert.alert("No Data", "No exercise data available to analyze.");
      return;
    }

    setIsAnalyzing(true);
    try {
      // Create device tag map
      const deviceTagMap = new Map<string, DeviceTag>();
      sensors.forEach((sensor) => {
        if (sensor.deviceTag && exerciseDataRef.current.has(sensor.id)) {
          deviceTagMap.set(sensor.id, sensor.deviceTag);
          console.log(`🔬 [UI] Added sensor ${sensor.id} with DeviceTag ${sensor.deviceTag} (${getDeviceTagName(sensor.deviceTag)})`);
        }
      });

      console.log(`🔬 [UI] deviceTagMap size: ${deviceTagMap.size}`);
      console.log(`🔬 [UI] deviceTagMap entries:`, Array.from(deviceTagMap.entries()).map(([id, tag]) => ({ id, tag })));

      if (deviceTagMap.size === 0) {
        console.error("❌ [UI] No sensors with device tags found");
        Alert.alert("Error", "No sensors with device tags found. Please assign device tags to sensors.");
        return;
      }

      // Log exercise data summary
      exerciseDataRef.current.forEach((data, sensorId) => {
        console.log(`🔬 [UI] Sensor ${sensorId}: ${data.length} samples`);
        if (data.length > 0) {
          console.log(`🔬 [UI]   First sample:`, {
            PacketCounter: data[0].PacketCounter,
            SampleTimeFine: data[0].SampleTimeFine,
            Euler_X: data[0].Euler_X,
            Euler_Y: data[0].Euler_Y,
            Euler_Z: data[0].Euler_Z,
          });
        }
      });

      // Convert to ZIP
      console.log("🔬 [UI] Converting exercise data to ZIP...");
      const zipBase64 = await convertBleDataToZip(exerciseDataRef.current, deviceTagMap, exerciseStartTime);
      console.log(`🔬 [UI] ZIP conversion complete, base64 length: ${zipBase64.length}`);
      
      // Analyze with local API
      console.log("🔬 [UI] Starting analysis with local API...");
      const localAnalysisApi = createLocalAnalysisApi();
      
      const result = await localAnalysisApi.analyzeZip(zipBase64, {
        thresholdAngleDeg: 18,
        minPeakDistanceSec: 0.6,
        bodyHeight_m: 1.75,
        bodyMass_kg: 70,
        artificialDelayMs: 350,
      });

      console.log("🔬 [UI] Analysis complete!");
      console.log("🔬 [UI] Analysis result:", JSON.stringify(result, null, 2));
      console.log("🔬 [UI] Missing sensors:", result.missingSensors);
      console.log("🔬 [UI] Knee left ROM:", result.knee.left?.rom);
      console.log("🔬 [UI] Knee right ROM:", result.knee.right?.rom);
      console.log("🔬 [UI] Hip left ROM:", result.hip.left?.rom);
      console.log("🔬 [UI] Hip right ROM:", result.hip.right?.rom);

      setBleAnalysisResult(result);

      // Auto-save to Azure (same as ZIP upload flow)
      if (user) {
        const patientId = user.role === "patient" ? user.id : params.patientId;
        const exerciseTypeId = params.exerciseTypeId;
        const exerciseName = params.exerciseName;

        if (patientId && exerciseTypeId) {
          try {
            const endTime = new Date();
            const session = await createSessionFromAnalysisResult(result, {
              patientId,
              exerciseTypeId,
              exerciseName,
              startTime: exerciseStartTime,
              endTime,
            });
            if (session) {
              console.log("🔬 [UI] Session saved to server:", session.id);
              setCanAnalyze(false);
              // Refresh dashboard before alert so data is ready when user navigates back
              await Promise.all([
                fetchPatients(),
                fetchAssignedExercises(patientId),
              ]);
              Alert.alert(
                "Analysis Complete",
                `Results saved successfully!\n\nMissing sensors: ${result.missingSensors.length > 0 ? result.missingSensors.join(", ") : "None"}`
              );
            } else {
              Alert.alert(
                "Analysis Complete",
                `Analysis completed but save failed. Please try again.\n\nMissing sensors: ${result.missingSensors.length > 0 ? result.missingSensors.join(", ") : "None"}`
              );
            }
          } catch (saveError) {
            console.error("Error saving BLE results to server:", saveError);
            Alert.alert(
              "Analysis Complete",
              `Analysis completed but could not save to server: ${saveError instanceof Error ? saveError.message : String(saveError)}\n\nYou can try analyzing again.`
            );
          }
        } else {
          Alert.alert(
            "Analysis Complete",
            `Analysis completed. Go back to Movement Analysis, select patient and exercise, then record and analyze again to save.\n\nMissing sensors: ${result.missingSensors.length > 0 ? result.missingSensors.join(", ") : "None"}`
          );
        }
      } else {
        Alert.alert(
          "Analysis Complete",
          `Analysis completed successfully!\n\nMissing sensors: ${result.missingSensors.length > 0 ? result.missingSensors.join(", ") : "None"}`
        );
      }
    } catch (error) {
      console.error("❌ [UI] Error analyzing exercise:", error);
      console.error("❌ [UI] Error type:", typeof error);
      console.error("❌ [UI] Error message:", error instanceof Error ? error.message : String(error));
      console.error("❌ [UI] Error stack:", error instanceof Error ? error.stack : 'No stack');
      Alert.alert(
        "Analysis Error",
        `Failed to analyze exercise: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleShowCsv = useCallback((sensorId: string) => {
    const data = exerciseDataRef.current.get(sensorId);
    if (!data || data.length === 0) {
      Alert.alert("No Data", "No recorded samples found for this sensor yet.");
      return;
    }

    if (!exerciseStartTime) {
      Alert.alert("No Start Time", "Exercise start time is unavailable. Please record an exercise again.");
      return;
    }

    const sensor = sensors.find((s) => s.id === sensorId);
    if (!sensor) {
      Alert.alert("Sensor Not Found", "Unable to locate sensor information.");
      return;
    }

    if (!sensor.deviceTag) {
      Alert.alert("Assign Device Tag", "Please assign a device tag to this sensor before exporting the CSV.");
      return;
    }

    try {
      const deviceTagNum = typeof sensor.deviceTag === 'number' ? sensor.deviceTag : Number(sensor.deviceTag);
      const csv = createCSVForSensor(deviceTagNum, sensorId, data, exerciseStartTime);
      const displayName = sensor.hardwareDeviceTag
        ? `${sensor.name} (DOT tag ${sensor.hardwareDeviceTag})`
        : sensor.name || sensorId;
      setCsvModalSensorName(displayName);
      setCsvModalContent(csv);
      setCsvModalVisible(true);
    } catch (error) {
      console.error("❌ [UI] Error generating CSV preview:", error);
      Alert.alert("Error", "Failed to generate CSV preview for this sensor.");
    }
  }, [exerciseStartTime, sensors]);

  const handleCloseCsvModal = useCallback(() => {
    setCsvModalVisible(false);
    setCsvModalContent(null);
    setCsvModalSensorName("");
  }, []);

  const handleStartScan = async () => {
    console.log("🔍 [UI] handleStartScan() called");
    console.log("🔍 [UI] bleService available:", bleService.isAvailable());
    
    try {
      console.log("🔍 [UI] Setting scanning state to true");
      setScanning(true);
      
      console.log("🔍 [UI] Calling bleService.startScanning()...");
      await bleService.startScanning();
      console.log("✅ [UI] Scan started successfully!");
      
      // Auto-stop after 10 seconds
      setTimeout(async () => {
        console.log("🔍 [UI] Auto-stopping scan after 10 seconds");
        try {
          await bleService.stopScanning();
          setScanning(false);
          console.log("✅ [UI] Auto-stop completed");
        } catch (stopError) {
          console.error("❌ [UI] Error in auto-stop:", stopError);
          setScanning(false);
        }
      }, 10000);
    } catch (error) {
      console.error("❌ [UI] Error in handleStartScan:");
      console.error("❌ [UI] Error type:", typeof error);
      console.error("❌ [UI] Error:", error);
      console.error("❌ [UI] Error message:", error instanceof Error ? error.message : String(error));
      console.error("❌ [UI] Error stack:", error instanceof Error ? error.stack : 'No stack');
      
      setScanning(false);
      
      // Show error alert
      const errorMessage = error instanceof Error ? error.message : "Failed to start scanning";
      console.log("🔍 [UI] Showing alert with message:", errorMessage);
      Alert.alert(
        "Scan Error",
        errorMessage
      );
    }
  };

  const handleStopScan = async () => {
    try {
      await bleService.stopScanning();
      setScanning(false);
    } catch (error) {
      console.error("Error stopping scan:", error);
    }
  };

  const handleRescan = async () => {
    console.log("🔄 [UI] handleRescan() called");

    // Reset component state
    setConnecting(new Set());
    setSensors([]);
    setIsExerciseActive(false);
    isExerciseActiveRef.current = false;
    setExerciseStartTime(null);
    setExerciseData(new Map());
    exerciseDataRef.current = new Map();
    firstTimestampsRef.current = new Map();
    setPacketCounters(new Map());
    setRealTimeLogs([]);
    setCanAnalyze(false);
    setBleAnalysisResult(null);
    noDataWarningShownRef.current = false;
    handleCloseCsvModal();

    try {
      await bleService.reset();
      updateSensorList();
      setScanning(false);
      await handleStartScan();
    } catch (error) {
      console.error("❌ [UI] Error during rescan:", error);
      Alert.alert(
        "Rescan Error",
        error instanceof Error ? error.message : "Failed to rescan sensors."
      );
    }
  };

  const handleConnect = async (sensorId: string) => {
    try {
      setConnecting((prev) => new Set(prev).add(sensorId));
      await bleService.connectToSensor(sensorId);
    } catch (error) {
      setConnecting((prev) => {
        const next = new Set(prev);
        next.delete(sensorId);
        return next;
      });
      Alert.alert(
        "Connection Error",
        error instanceof Error ? error.message : "Failed to connect"
      );
    }
  };

  const handleDisconnect = async (sensorId: string) => {
    if (Platform.OS === "android") {
      // Defer to next frame + after UI interactions (avoids native crash during button press)
      InteractionManager.runAfterInteractions(() => {
        setTimeout(async () => {
          try {
            await bleService.disconnectFromSensor(sensorId);
            setTimeout(updateSensorList, 100);
          } catch (error) {
            Alert.alert(
              "Disconnect Error",
              error instanceof Error ? error.message : "Failed to disconnect"
            );
          }
        }, 100);
      });
    } else {
      try {
        await bleService.disconnectFromSensor(sensorId);
        updateSensorList();
      } catch (error) {
        Alert.alert(
          "Disconnect Error",
          error instanceof Error ? error.message : "Failed to disconnect"
        );
      }
    }
  };

  const handleAssignTag = (sensorId: string, tag: DeviceTag) => {
    bleService.setDeviceTag(sensorId, tag);
    updateSensorList();
  };

  const getDeviceTagName = (tag?: DeviceTag): string => {
    switch (tag) {
      case DeviceTag.RIGHT_THIGH:
        return "Right Thigh";
      case DeviceTag.RIGHT_SHANK:
        return "Right Shank";
      case DeviceTag.LEFT_THIGH:
        return "Left Thigh";
      case DeviceTag.LEFT_SHANK:
        return "Left Shank";
      case DeviceTag.PELVIS:
        return "Pelvis";
      default:
        return "Not assigned";
    }
  };

  const renderSensorItem = ({ item }: { item: MovellaSensor }) => {
    const isConnecting = connecting.has(item.id);
    const connectedCount = sensors.filter((s) => s.connected).length;
    const recordedSamples = exerciseData.get(item.id);
    const hasRecordedData = !!recordedSamples && recordedSamples.length > 0;

    return (
      <View
        style={[
          styles.sensorCard,
          {
            backgroundColor: colors.card,
            borderColor: item.connected
              ? colors.success
              : colors.mediumGray,
            borderWidth: item.connected ? 2 : 1,
          },
        ]}
      >
        <View style={styles.sensorHeader}>
          <View style={styles.sensorInfo}>
            <View
              style={[
                styles.sensorIcon,
                {
                  backgroundColor: item.connected
                    ? colors.success + "15"
                    : colors.purple[100],
                },
              ]}
            >
              <Ionicons
                name={item.connected ? "bluetooth" : "bluetooth-outline"}
                size={24}
                color={item.connected ? colors.success : colors.purple[500]}
              />
            </View>
            <View style={styles.sensorDetails}>
              <Text style={[styles.sensorName, { color: colors.text }]}>
                {item.name}
              </Text>
              <Text
                style={[styles.sensorMac, { color: colors.textSecondary }]}
              >
                {item.macAddress}
              </Text>
              {item.deviceTag && (
                <Text
                  style={[
                    styles.sensorTag,
                    { color: colors.primary },
                  ]}
                >
                  Device Tag: {item.deviceTag}
                </Text>
              )}
              <Text
                style={[
                  styles.hardwareTag,
                  { color: colors.textSecondary },
                ]}
              >
                DOT tag: {item.hardwareDeviceTag ?? "—"}
              </Text>
            </View>
          </View>
          {item.connected && (
            <View style={styles.connectedBadge}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: colors.success },
                ]}
              />
              <Text style={[styles.statusText, { color: colors.success }]}>
                Connected
              </Text>
            </View>
          )}
        </View>

        {item.batteryLevel !== undefined && (
          <View style={styles.batteryInfo}>
            <Ionicons
              name="battery-half-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.batteryText, { color: colors.textSecondary }]}
            >
              {item.batteryLevel}%
            </Text>
          </View>
        )}

        <View style={styles.sensorActions}>
          {!item.connected ? (
            <TouchableOpacity
              style={[
                styles.actionButton,
                {
                  backgroundColor: colors.primary,
                  opacity: isConnecting ? 0.6 : 1,
                },
              ]}
              onPress={() => handleConnect(item.id)}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="link" size={16} color={colors.white} />
                  <Text style={[styles.actionButtonText, { color: colors.white }]}>
                    Connect
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  { backgroundColor: colors.error || "#FF3B30" },
                ]}
                onPress={() => handleDisconnect(item.id)}
              >
                <Ionicons name="close" size={16} color={colors.white} />
                <Text style={[styles.actionButtonText, { color: colors.white }]}>
                  Disconnect
                </Text>
              </TouchableOpacity>
              <View style={styles.tagSelector}>
                <Text
                  style={[
                    styles.tagLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  {item.deviceTag ? 'Edit Tag:' : 'Assign Tag:'}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {[
                    DeviceTag.RIGHT_THIGH,
                    DeviceTag.RIGHT_SHANK,
                    DeviceTag.LEFT_THIGH,
                    DeviceTag.LEFT_SHANK,
                    DeviceTag.PELVIS,
                  ].map((tag) => (
                    <TouchableOpacity
                      key={tag}
                      style={[
                        styles.tagButton,
                        {
                          backgroundColor: item.deviceTag === tag ? colors.primary : colors.background,
                          borderColor: item.deviceTag === tag ? colors.primary : colors.mediumGray,
                        },
                      ]}
                      onPress={() => handleAssignTag(item.id, tag)}
                    >
                      <Text
                        style={[
                          styles.tagButtonText,
                          { 
                            color: item.deviceTag === tag ? colors.white : colors.text,
                            fontWeight: item.deviceTag === tag ? '600' : '500',
                          },
                        ]}
                      >
                        {getDeviceTagName(tag)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </>
          )}
          {hasRecordedData && (
            <TouchableOpacity
              style={[
                styles.csvButton,
                {
                  borderColor: colors.primary,
                  backgroundColor: colors.primary + "10",
                },
              ]}
              onPress={() => handleShowCsv(item.id)}
            >
              <Ionicons name="document-text-outline" size={16} color={colors.primary} />
              <Text style={[styles.csvButtonText, { color: colors.primary }]}>
                Show CSV
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const connectedCount = sensors.filter((s) => s.connected).length;

  return (
    <ErrorBoundary>
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>
          Movella DOT Sensors
        </Text>
        {connectedCount > 0 && (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {connectedCount} sensor{connectedCount > 1 ? "s" : ""} connected
          </Text>
        )}
      </View>

      <View style={styles.scanSection}>
        {!scanning ? (
          <TouchableOpacity
            style={[styles.scanButton, { backgroundColor: colors.primary }]}
            onPress={handleStartScan}
          >
            <Ionicons name="search" size={20} color={colors.white} />
            <Text style={[styles.scanButtonText, { color: colors.white }]}>
              Start Scanning
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.scanButton,
              { backgroundColor: colors.error || "#FF3B30" },
            ]}
            onPress={handleStopScan}
          >
            <ActivityIndicator size="small" color={colors.white} />
            <Text style={[styles.scanButtonText, { color: colors.white }]}>
              Scanning...
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.rescanButton,
            {
              borderColor: colors.primary,
            },
          ]}
          onPress={handleRescan}
          disabled={scanning}
        >
          <Ionicons
            name="refresh"
            size={16}
            color={scanning ? colors.mediumGray : colors.primary}
          />
          <Text
            style={[
              styles.rescanButtonText,
              { color: scanning ? colors.mediumGray : colors.primary },
            ]}
          >
            Rescan Sensors
          </Text>
        </TouchableOpacity>
      </View>

      {!bleService.isAvailable() && (
        <View style={styles.warningBox}>
          <Ionicons name="warning-outline" size={20} color={colors.warning || "#FF9500"} />
          <Text style={[styles.warningText, { color: colors.text }]}>
            BLE not available. Please install react-native-ble-plx or enable Bluetooth.
          </Text>
        </View>
      )}

      {/* Exercise Section */}
      {connectedCount > 0 && (
        <View style={styles.exerciseSection}>
          <TouchableOpacity
            style={styles.collapseHeader}
            onPress={() => setExerciseSectionCollapsed(!exerciseSectionCollapsed)}
          >
            <Text style={[styles.collapseHeaderText, { color: colors.text }]}>
              Exercise Control
            </Text>
            <Ionicons
              name={exerciseSectionCollapsed ? "chevron-down" : "chevron-up"}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {!exerciseSectionCollapsed && (
            <View style={styles.exerciseSectionContent}>
          {/* Testing Mode Toggle */}
          <View style={styles.testingModeContainer}>
            <View style={styles.testingModeRow}>
              <Text style={[styles.testingModeLabel, { color: colors.text }]}>
                Testing Mode
              </Text>
              <Switch
                value={testingMode}
                onValueChange={setTestingMode}
                trackColor={{ false: colors.mediumGray, true: colors.primary + '80' }}
                thumbColor={testingMode ? colors.primary : colors.white}
              />
            </View>
            <Text style={[styles.testingModeHint, { color: colors.textSecondary }]}>
              {testingMode 
                ? "Exercise can start with 1+ sensors" 
                : "Requires all 5 sensors"}
            </Text>
          </View>
          
          {!isExerciseActive ? (
            <TouchableOpacity
              style={[
                styles.exerciseButton,
                {
                  backgroundColor: hasAllSensorsConnected(testingMode) ? colors.primary : colors.mediumGray,
                },
              ]}
              onPress={handleStartExercise}
              disabled={!hasAllSensorsConnected(testingMode)}
            >
              <Ionicons name="play" size={20} color={colors.white} />
              <Text style={[styles.exerciseButtonText, { color: colors.white }]}>
                Start Exercise
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.exerciseButton,
                { backgroundColor: colors.error || "#FF3B30" },
              ]}
              onPress={handleStopExercise}
            >
              <Ionicons name="stop" size={20} color={colors.white} />
              <Text style={[styles.exerciseButtonText, { color: colors.white }]}>
                Stop Exercise
              </Text>
            </TouchableOpacity>
          )}
          
          {isExerciseActive && (
            <>
              <View style={styles.exerciseIndicator}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.exerciseIndicatorText, { color: colors.text }]}>
                  Recording exercise data...
                </Text>
              </View>
              
              {/* Packet Counters */}
              {Array.from(packetCounters.entries()).length > 0 && (
                <View style={styles.packetCountersContainer}>
                  <Text style={[styles.packetCountersTitle, { color: colors.text }]}>
                    Packets received:
                  </Text>
                        {sensors
                          .filter(s => s.connected && packetCounters.has(s.id))
                          .map((sensor) => (
                            <View key={sensor.id} style={styles.packetCounterRow}>
                              <Text style={[styles.packetCounterLabel, { color: colors.textSecondary }]}>
                                {sensor.name || `Sensor ${sensor.id.substring(0, 8)}`} (Tag {sensor.deviceTag}):
                              </Text>
                              <Text style={[styles.packetCounterValue, { color: colors.primary }]}>
                                {packetCounters.get(sensor.id) || 0}
                              </Text>
                            </View>
                          ))}
                </View>
              )}
              
              {/* Real-time Logs */}
              <View style={styles.logsContainer}>
                <View style={styles.logsHeader}>
                  <Text style={[styles.logsTitle, { color: colors.text }]}>
                    Real-time Data Logs
                  </Text>
                  <TouchableOpacity
                    onPress={handleClearLogs}
                    style={styles.clearLogsButton}
                  >
                    <Text style={[styles.clearLogsButtonText, { color: colors.primary }]}>
                      Clear Logs
                    </Text>
                  </TouchableOpacity>
                </View>
                <ScrollView
                  ref={logsScrollViewRef}
                  style={styles.logsScrollView}
                  contentContainerStyle={styles.logsContent}
                  showsVerticalScrollIndicator={true}
                >
                  {realTimeLogs.length === 0 ? (
                    <Text style={[styles.noLogsText, { color: colors.textSecondary }]}>
                      Waiting for data...
                    </Text>
                  ) : (
                    realTimeLogs.map((log, index) => (
                      <View key={index} style={[styles.logEntry, { borderBottomColor: colors.border }]}>
                        <View style={styles.logHeader}>
                          <Text style={[styles.logTimestamp, { color: colors.textSecondary }]}>
                            {log.timestamp}
                          </Text>
                          <Text style={[styles.logSensorName, { color: colors.text }]}>
                            {log.sensorName}
                          </Text>
                          <Text style={[styles.logDeviceTag, { color: colors.primary }]}>
                            {log.deviceTag}
                          </Text>
                          <Text style={[styles.logPacketCounter, { color: colors.textSecondary }]}>
                            #{log.packetCounter}
                          </Text>
                        </View>
                        <Text style={[styles.logData, { color: colors.textSecondary }]}>
                          Euler: {log.euler.x.toFixed(2)}, {log.euler.y.toFixed(2)}, {log.euler.z.toFixed(2)}
                        </Text>
                        <Text style={[styles.logData, { color: colors.textSecondary }]}>
                          FreeAcc: {log.freeAcc.x.toFixed(2)}, {log.freeAcc.y.toFixed(2)}, {log.freeAcc.z.toFixed(2)}
                        </Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              </View>
            </>
          )}
          
          {canAnalyze && (
            <TouchableOpacity
              style={[
                styles.analyzeButton,
                {
                  backgroundColor: isAnalyzing ? (colors.gray?.[400] ?? "#9E9E9E") : (colors.success || "#34C759"),
                  opacity: isAnalyzing ? 0.7 : 1,
                },
              ]}
              onPress={handleAnalyzeExercise}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="analytics" size={20} color={colors.white} />
              )}
              <Text style={[styles.analyzeButtonText, { color: colors.white }]}>
                {isAnalyzing ? "Analyzing..." : "Analyze Exercise"}
              </Text>
            </TouchableOpacity>
          )}
          
          {!hasAllSensorsConnected(testingMode) && connectedCount > 0 && !testingMode && (
            <Text style={[styles.sensorWarning, { color: colors.warning || "#FF9500" }]}>
              {connectedCount >= 5
                ? "Assign tags to all sensors to start exercise"
                : `${5 - connectedCount} more sensor${5 - connectedCount > 1 ? "s" : ""} needed to start exercise`}
            </Text>
          )}
            </View>
          )}
        </View>
      )}

      {/* Sensors Section */}
      <View style={styles.sensorsSection}>
        <TouchableOpacity
          style={styles.collapseHeader}
          onPress={() => setSensorsSectionCollapsed(!sensorsSectionCollapsed)}
        >
          <Text style={[styles.collapseHeaderText, { color: colors.text }]}>
            Sensors ({sensors.length})
          </Text>
          <Ionicons
            name={sensorsSectionCollapsed ? "chevron-down" : "chevron-up"}
            size={20}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        {!sensorsSectionCollapsed && (
          <FlatList
            data={sensors}
            renderItem={renderSensorItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            scrollEnabled={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="bluetooth-outline"
                  size={48}
                  color={colors.textSecondary}
                />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No sensors found
                </Text>
                <Text
                  style={[
                    styles.emptySubtext,
                    { color: colors.textSecondary },
                  ]}
                >
                  Tap "Start Scanning" to search for Movella DOT sensors
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* Analysis Section */}
      {bleAnalysisResult && (
        <View style={[styles.analysisSection, { backgroundColor: colors.card }]}>
          <TouchableOpacity
            style={styles.collapseHeader}
            onPress={() => setAnalysisSectionCollapsed(!analysisSectionCollapsed)}
          >
            <Text style={[styles.collapseHeaderText, { color: colors.text }]}>
              Analysis Results
            </Text>
            <Ionicons
              name={analysisSectionCollapsed ? "chevron-down" : "chevron-up"}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {!analysisSectionCollapsed && (
            <View style={styles.analysisSectionContent}>
              <LocalAnalysisResults result={bleAnalysisResult} />
            </View>
          )}
        </View>
      )}
      </ScrollView>
      <Modal
        visible={csvModalVisible}
        animationType="slide"
        onRequestClose={handleCloseCsvModal}
        presentationStyle="fullScreen"
      >
        <SafeAreaView
          style={[styles.modalContainer, { backgroundColor: colors.background }]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {csvModalSensorName || "CSV Preview"}
            </Text>
            <TouchableOpacity
              onPress={handleCloseCsvModal}
              style={styles.modalCloseButton}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <Text
              style={[
                styles.modalCsvContent,
                { color: colors.text },
              ]}
              selectable
            >
              {csvModalContent || ""}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      </SafeAreaView>
    </ErrorBoundary>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  scanSection: {
    padding: 16,
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  scanButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  rescanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    backgroundColor: "transparent",
  },
  rescanButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: "#FFF3E0",
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 0,
  },
  collapseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  collapseHeaderText: {
    fontSize: 16,
    fontWeight: "600",
  },
  sensorsSection: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5E5",
    overflow: "hidden",
  },
  analysisSection: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  analysisSectionContent: {
    padding: 16,
  },
  sensorCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  sensorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  sensorInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
  },
  sensorIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  sensorDetails: {
    flex: 1,
  },
  sensorName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  sensorMac: {
    fontSize: 12,
    marginBottom: 4,
  },
  sensorTag: {
    fontSize: 12,
    fontWeight: "500",
  },
  hardwareTag: {
    fontSize: 12,
    marginTop: 2,
  },
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "500",
  },
  batteryInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
  },
  batteryText: {
    fontSize: 12,
  },
  sensorActions: {
    gap: 8,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  csvButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 8,
  },
  csvButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  tagSelector: {
    marginTop: 8,
  },
  tagLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  tagButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: 8,
  },
  tagButtonText: {
    fontSize: 12,
    fontWeight: "500",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
  exerciseSection: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5E5",
    overflow: "hidden",
  },
  exerciseSectionContent: {
    padding: 16,
  },
  exerciseButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
    marginBottom: 12,
  },
  exerciseButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  exerciseIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
  },
  exerciseIndicatorText: {
    fontSize: 14,
  },
  analyzeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  analyzeButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  sensorWarning: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
  },
  testingModeContainer: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  testingModeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  testingModeLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  testingModeHint: {
    fontSize: 12,
    marginTop: 4,
  },
  packetCountersContainer: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#F5F5F5",
  },
  packetCountersTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  packetCounterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  packetCounterLabel: {
    fontSize: 12,
    flex: 1,
  },
  packetCounterValue: {
    fontSize: 12,
    fontWeight: "600",
  },
  logsContainer: {
    marginTop: 12,
    marginBottom: 12,
    maxHeight: 300,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  logsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  logsTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  clearLogsButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearLogsButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  logsScrollView: {
    maxHeight: 250,
  },
  logsContent: {
    padding: 8,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  modalCloseButton: {
    padding: 6,
  },
  modalScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  modalScrollContent: {
    paddingVertical: 16,
  },
  modalCsvContent: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  logEntry: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  logHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 4,
    gap: 8,
  },
  logTimestamp: {
    fontSize: 11,
    fontFamily: "monospace",
  },
  logSensorName: {
    fontSize: 12,
    fontWeight: "600",
  },
  logDeviceTag: {
    fontSize: 11,
    fontWeight: "500",
  },
  logPacketCounter: {
    fontSize: 11,
    fontFamily: "monospace",
  },
  logData: {
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 2,
  },
  noLogsText: {
    fontSize: 12,
    textAlign: "center",
    padding: 20,
    fontStyle: "italic",
  },
});

export default BleConnectionScreen;

