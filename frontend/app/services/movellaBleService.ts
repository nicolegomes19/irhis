/**
 * Movella DOT BLE Service
 * Implements Bluetooth Low Energy communication with Movella DOT sensors
 * Based on Movella DOT BLE Service Specification (Document XD0506P, Revision C)
 */

import { Platform, PermissionsAndroid, InteractionManager } from 'react-native';
import { BleManager, Device, State, Characteristic } from 'react-native-ble-plx';
import * as THREE from 'three';

// BLE Manager instance - Only works with Development Client, not Expo Go
let bleManagerInstance: BleManager | null = null;
let BleManagerAvailable = false;
let BleManagerError: Error | null = null;

try {
  // Try to create BleManager instance
  // This will fail in Expo Go because the native module is not available
  bleManagerInstance = new BleManager();
  BleManagerAvailable = true;
  console.log('✅ react-native-ble-plx initialized');
} catch (error: any) {
  // Module not available - this is expected in Expo Go
  BleManagerAvailable = false;
  BleManagerError = error instanceof Error ? error : new Error(String(error));
  if (__DEV__) {
    console.log('react-native-ble-plx module check:', error?.message || 'not available');
    // Check for the specific "createClient of null" error
    if (error?.message?.includes('createClient') || error?.message?.includes('null')) {
      console.warn('⚠️ BLE native module not linked. This is expected in Expo Go. Use a Development Build for BLE support.');
    }
  }
}

// Base UUID for Movella DOT: 1517xxxx-4947-11E9-8646-D663BD873D93
const MOVELLA_BASE_UUID = "1517{XXXX}-4947-11E9-8646-D663BD873D93";

// Service UUIDs (short form)
const CONFIGURATION_SERVICE_UUID = "1000";
const MEASUREMENT_SERVICE_UUID = "2000";
const BATTERY_SERVICE_UUID = "3000";
const MESSAGE_SERVICE_UUID = "7000";

// Characteristic UUIDs
const DEVICE_INFO_CHAR_UUID = "1001";
const DEVICE_CONTROL_CHAR_UUID = "1002";
const DEVICE_REPORT_CHAR_UUID = "1004";
const MEASUREMENT_CONTROL_CHAR_UUID = "2001";
const MEASUREMENT_LONG_PAYLOAD_CHAR_UUID = "2002";
const MEASUREMENT_MEDIUM_PAYLOAD_CHAR_UUID = "2003";
const MEASUREMENT_SHORT_PAYLOAD_CHAR_UUID = "2004";
const BATTERY_CHAR_UUID = "3001";
const MESSAGE_CONTROL_CHAR_UUID = "7001";
const MESSAGE_NOTIFICATION_CHAR_UUID = "7003";

// Payload modes
export enum PayloadMode {
  ORIENTATION_QUATERNION = 5, // 20 bytes - Timestamp + Quaternion
  COMPLETE_QUATERNION = 3, // 32 bytes - Timestamp + Quaternion + Free acceleration
  EXTENDED_QUATERNION = 2, // 36 bytes - Timestamp + Quaternion + Free acceleration + Status + Clipping counts
}

// Device Tag mapping (from Movella spec)
export enum DeviceTag {
  RIGHT_THIGH = 1,
  RIGHT_SHANK = 2,
  LEFT_THIGH = 3,
  LEFT_SHANK = 4,
  PELVIS = 5,
}

export interface MovellaSensor {
  id: string;
  name: string;
  macAddress: string;
  deviceTag?: DeviceTag;
  connected: boolean;
  batteryLevel?: number;
  firmwareVersion?: string;
  serialNumber?: string;
  hardwareDeviceTag?: string;
}

export interface QuaternionData {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface MeasurementData {
  timestamp: number; // microseconds
  quaternion: QuaternionData;
  deviceTag: DeviceTag;
}

// Extended measurement data for CSV export (Movella DOT Fusion format)
export interface FusionMeasurementData {
  PacketCounter: number;
  SampleTimeFine: number; // microseconds since start
  Euler_X: number; // degrees
  Euler_Y: number; // degrees
  Euler_Z: number; // degrees
  FreeAcc_X: number;
  FreeAcc_Y: number;
  FreeAcc_Z: number;
  Status: number;
}

export interface BleServiceCallbacks {
  onSensorDiscovered?: (sensor: MovellaSensor) => void;
  onSensorConnected?: (sensorId: string) => void;
  onSensorDisconnected?: (sensorId: string) => void;
  onMeasurementData?: (sensorId: string, data: MeasurementData) => void;
  onFusionMeasurementData?: (sensorId: string, data: FusionMeasurementData) => void;
  onBatteryLevel?: (sensorId: string, level: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Convert Uint8Array to hex string for logging
 */
function bufferToHex(buffer: Uint8Array, maxBytes: number = 20): string {
  const bytes = Array.from(buffer.slice(0, maxBytes))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
  return buffer.length > maxBytes ? `${bytes}...` : bytes;
}

/**
 * Convert short UUID to full UUID
 */
function getFullUuid(shortUuid: string): string {
  return MOVELLA_BASE_UUID.replace("{XXXX}", shortUuid);
}

/**
 * Convert full UUID to short UUID
 */
function getShortUuid(fullUuid: string): string {
  return fullUuid.substring(4, 8);
}

/**
 * Parse little-endian float from buffer
 */
function readFloatLE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  return view.getFloat32(0, true); // little-endian
}

/**
 * Parse little-endian uint32 from buffer
 */
function readUint32LE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  return view.getUint32(0, true); // little-endian
}

/**
 * Parse quaternion from buffer (little-endian, w,x,y,z format)
 */
function parseQuaternion(buffer: Uint8Array, offset: number): QuaternionData {
  return {
    w: readFloatLE(buffer, offset),
    x: readFloatLE(buffer, offset + 4),
    y: readFloatLE(buffer, offset + 8),
    z: readFloatLE(buffer, offset + 12),
  };
}

/**
 * Convert base64 string to Uint8Array (React Native compatible)
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string (React Native compatible)
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert quaternion to Euler angles (ZYX intrinsic) in degrees
 * Uses THREE.js for conversion
 */
function quaternionToEulerZYX(qw: number, qx: number, qy: number, qz: number): { x: number; y: number; z: number } {
  const quaternion = new THREE.Quaternion(qx, qy, qz, qw).normalize();
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'ZYX');
  
  return {
    x: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    z: THREE.MathUtils.radToDeg(euler.z),
  };
}

/**
 * Movella DOT BLE Service
 * Handles scanning, connection, and data streaming from Movella DOT sensors
 */
export class MovellaBleService {
  private sensors: Map<string, MovellaSensor> = new Map();
  private callbacks: BleServiceCallbacks = {};
  private isScanning = false;
  private isInitialized = false;

  // BLE Manager instance (react-native-ble-plx)
  private bleManager: BleManager | null = null;
  private scanSubscription: any = null;
  private stateSubscription: any = null;
  private notificationSubscriptions: Map<string, any> = new Map();
  // Store Device objects for connection
  private deviceCache: Map<string, Device> = new Map();
  // Track which sensors are intentionally stopping (to ignore cancellation errors)
  private stoppingSensors: Set<string> = new Set();
  // Heartbeat intervals for active measurements
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  // Message service notification subscriptions (for configuration responses)
  private messageSubscriptions: Map<string, any> = new Map();
  // Pending resolvers for hardware tag requests
  private hardwareTagResolvers: Map<string, (tag: string | null) => void> = new Map();

  /**
   * Reset BLE service state: stop measurements, disconnect, clear caches
   */
  async reset(): Promise<void> {
    console.log("🔄 [BLE] Resetting Movella BLE service...");

    // Stop heartbeat timers
    this.heartbeatIntervals.forEach((interval) => clearInterval(interval));
    this.heartbeatIntervals.clear();

    // Stop scanning if running
    if (this.isScanning) {
      try {
        await this.stopScanning();
      } catch (error) {
        console.warn("⚠️ [BLE] Error stopping scan during reset:", error);
      }
    }

    const sensors = Array.from(this.sensors.values());

    // Stop measurement and disconnect devices sequentially (Android BLE struggles with concurrent ops)
    for (let i = 0; i < sensors.length; i++) {
      const sensorId = sensors[i].id;

      try {
        await this.stopMeasurement(sensorId);
      } catch (error) {
        console.warn(`⚠️ [BLE] Error stopping measurement for ${sensorId}:`, error);
      }

      const messageSubscription = this.messageSubscriptions.get(sensorId);
      if (messageSubscription) {
        try {
          messageSubscription.remove();
        } catch (error) {
          console.warn(`⚠️ [BLE] Error removing message subscription for ${sensorId}:`, error);
        }
      }
      this.messageSubscriptions.delete(sensorId);
      this.hardwareTagResolvers.delete(sensorId);

      try {
        await this.disconnectFromSensor(sensorId);
      } catch (error) {
        console.warn(`⚠️ [BLE] Error disconnecting sensor ${sensorId}:`, error);
      }

      if (Platform.OS === "android" && i < sensors.length - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // Clear internal caches and state
    this.notificationSubscriptions.clear();
    this.messageSubscriptions.clear();
    this.hardwareTagResolvers.clear();
    this.deviceCache.clear();
    this.stoppingSensors.clear();
    this.sensors.clear();
    this.scanSubscription = null;

    // On Android, destroy and recreate BleManager to force native cleanup of all
    // connections without going through cancelDeviceConnection (which crashes).
    if (Platform.OS === "android" && this.bleManager) {
      try {
        console.log("🔄 [BLE] Destroying BleManager to force native cleanup...");

        // Remove state listener before destroying to avoid callbacks during teardown
        if (this.stateSubscription) {
          try { this.stateSubscription.remove(); } catch (_) { /* already invalid */ }
          this.stateSubscription = null;
        }

        this.bleManager.destroy();
        this.bleManager = null;
        this.isInitialized = false;

        // Wait for native BLE stack to fully release resources
        await new Promise((r) => setTimeout(r, 500));

        // Create a fresh BleManager instance (the old global one is now destroyed)
        const freshManager = new BleManager();
        bleManagerInstance = freshManager;
        BleManagerAvailable = true;
        this.bleManager = freshManager;

        // Let the native RxBleClient stabilize before any operations
        await new Promise((r) => setTimeout(r, 200));

        this.isInitialized = true;
        this.setupEventListeners();
        console.log("✅ [BLE] BleManager recreated after reset");
      } catch (e) {
        console.warn("⚠️ [BLE] Error recreating BleManager:", e);
        // Leave service in a recoverable state: re-attempt on next scan
        this.bleManager = null;
        this.isInitialized = false;
        BleManagerAvailable = false;
        bleManagerInstance = null;
      }
    }

    console.log("✅ [BLE] Movella BLE service reset complete");
  }

  constructor() {
    // Initialize BLE manager when available
    this.initializeBleManager();
    this.setupEventListeners();
  }

  /**
   * Check and request Android BLE permissions
   * Required for BLE scanning on Android
   */
  private async checkAndroidPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true; // iOS handles permissions differently
    }

    try {
      const apiLevel = Platform.Version as number;
      
      // Android 12+ (API 31+) uses new permission model
      if (apiLevel >= 31) {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];

        const results = await PermissionsAndroid.requestMultiple(permissions);
        
        const allGranted = permissions.every(
          permission => results[permission] === PermissionsAndroid.RESULTS.GRANTED
        );

        if (!allGranted) {
          console.warn('⚠️ [BLE] Some Android permissions were denied:', results);
          return false;
        }

        return true;
      } else {
        // Android < 12 uses legacy permissions
        const permissions = [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ];

        const results = await PermissionsAndroid.requestMultiple(permissions);
        
        const locationGranted = 
          results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED ||
          results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;

        if (!locationGranted) {
          console.warn('⚠️ [BLE] Location permission denied (required for BLE scanning on Android < 12)');
          return false;
        }

        return true;
      }
    } catch (error) {
      console.error('❌ [BLE] Error checking Android permissions:', error);
      return false;
    }
  }

  /**
   * Initialize BLE manager
   * Uses react-native-ble-plx library
   * NOTE: Requires Development Client - does NOT work with Expo Go
   */
  private async initializeBleManager(): Promise<void> {
    try {
      // Check if JavaScript module is available; attempt recovery if it was
      // previously destroyed (e.g. after a failed reset())
      if (!BleManagerAvailable || !bleManagerInstance) {
        // Try to create a fresh instance as a recovery path
        try {
          const recovered = new BleManager();
          bleManagerInstance = recovered;
          BleManagerAvailable = true;
          console.log("🔄 [BLE] Recovered BleManager after previous destroy");
        } catch (recoveryError) {
          const isExpoGo = BleManagerError?.message?.includes('createClient') || 
                          BleManagerError?.message?.includes('null') ||
                          !BleManagerError;
          
          const platform = Platform.OS === 'android' ? 'Android' : 'iOS';
          const buildCommand = Platform.OS === 'android' 
            ? 'npx eas build --profile development --platform android'
            : 'npx eas build --profile development --platform ios';
          const runCommand = Platform.OS === 'android'
            ? 'npx expo run:android'
            : 'npx expo run:ios --device';
          
          const errorMsg = isExpoGo
            ? `❌ BLE not available in Expo Go!\n\n` +
              `react-native-ble-plx requires a Development Build.\n\n` +
              `To use Bluetooth on ${platform}:\n` +
              `1. Create a development build:\n` +
              `   cd frontend\n` +
              `   ${buildCommand}\n\n` +
              `2. Install the app on your device\n\n` +
              `3. Run: npx expo start --dev-client\n\n` +
              `Or build locally:\n` +
              `   npx expo prebuild\n` +
              `   ${runCommand}`
            : `❌ BLE Manager initialization failed!\n\n` +
              `Error: ${BleManagerError?.message || 'Unknown error'}\n\n` +
              `Please ensure:\n` +
              `1. You're using a Development Build (not Expo Go)\n` +
              `2. Native modules are properly linked\n` +
              `3. Run 'npx expo prebuild' and rebuild the app`;
          
          console.warn(`[BLE] ${errorMsg}`);
          this.isInitialized = false;
          return;
        }
      }
      
      // Check Android permissions before proceeding
      if (Platform.OS === 'android') {
        const hasPermissions = await this.checkAndroidPermissions();
        if (!hasPermissions) {
          console.warn('⚠️ [BLE] Android BLE permissions not granted. BLE features will be limited.');
          // Don't return false - allow initialization but features will fail gracefully
        }
      }
      
      console.log("🔍 [BLE] Setting bleManager instance");
      this.bleManager = bleManagerInstance;
      console.log("🔍 [BLE] bleManager set:", !!this.bleManager);
      
      // Wait for BLE manager to be ready
      console.log("🔍 [BLE] Waiting for BLE manager to be ready...");
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.isInitialized = true;
      console.log("✅ [BLE] BLE Manager initialized successfully!");
      console.log("✅ [BLE] isInitialized:", this.isInitialized);
      console.log("✅ [BLE] bleManager:", !!this.bleManager);
      console.log("✅ [BLE] Platform:", Platform.OS);
    } catch (error) {
      console.warn("❌ [BLE] BLE Manager not available. BLE features disabled.", error);
      this.isInitialized = false;
    }
  }

  /**
   * Setup event listeners for BLE events (react-native-ble-plx)
   */
  private setupEventListeners(): void {
    try {
      if (!this.bleManager) {
        console.warn("BLE Manager not available. Make sure you've run 'expo prebuild' and rebuilt the app.");
        return;
      }

      // Listen for Bluetooth state changes
      this.stateSubscription = this.bleManager.onStateChange((state: State) => {
        console.log("🔍 [BLE] Bluetooth state changed:", state);
        if (state === State.PoweredOff || state === State.Unauthorized) {
          // Stop scanning if Bluetooth is turned off
          if (this.isScanning) {
            this.stopScanning().catch(console.error);
          }
        }
      }, true); // true = emit current state immediately

      console.log("✅ [BLE] BLE event listeners setup successfully");
    } catch (error) {
      console.warn("❌ [BLE] Failed to setup BLE event listeners:", error);
    }
  }

  /**
   * Handle discovered BLE device (react-native-ble-plx)
   */
  private handleDiscoveredDevice(device: Device): void {
    const id = device.id;
    const name = device.name || device.localName || '';
    
    // Filter for Movella DOT devices
    const isMovellaDot = 
      name.toLowerCase().includes('movella') ||
      name.toLowerCase().includes('xsens') ||
      name.toLowerCase().includes('dot') ||
      id?.toUpperCase().startsWith('D4:22:CD');

    if (!isMovellaDot) return;

    // Check if device already discovered
    if (this.sensors.has(id)) {
      // Update device cache and name
      this.deviceCache.set(id, device);
      const existingSensor = this.sensors.get(id);
      if (existingSensor && name && name !== existingSensor.name) {
        existingSensor.name = name;
        this.sensors.set(id, existingSensor);
      }
      return;
    }

    // Store device for later connection
    this.deviceCache.set(id, device);

    const sensor: MovellaSensor = {
      id,
      name: name || `Movella DOT ${id.substring(0, 8)}`,
      macAddress: id,
      connected: false,
    };

    this.sensors.set(id, sensor);
    this.callbacks.onSensorDiscovered?.(sensor);
    console.log(`✅ [BLE] Discovered Movella DOT sensor: ${sensor.name} (${id})`);
  }

  /**
   * Handle characteristic value update (notification)
   */
  private handleCharacteristicUpdate(data: any): void {
    const { peripheral, characteristic, value } = data;
    const sensor = this.sensors.get(peripheral);
    if (!sensor || !sensor.connected) return;

    // Parse the characteristic UUID to determine what data it is
    const charShortUuid = getShortUuid(characteristic);
    
    if (charShortUuid === MEASUREMENT_SHORT_PAYLOAD_CHAR_UUID ||
        charShortUuid === MEASUREMENT_MEDIUM_PAYLOAD_CHAR_UUID ||
        charShortUuid === MEASUREMENT_LONG_PAYLOAD_CHAR_UUID) {
      // This is measurement data
      const buffer = new Uint8Array(value);
      const payloadMode = this.getPayloadModeForCharacteristic(charShortUuid);
      this.handleMeasurementData(peripheral, buffer, payloadMode);
    } else if (charShortUuid === BATTERY_CHAR_UUID) {
      // This is battery level
      const batteryLevel = value[0];
      sensor.batteryLevel = batteryLevel;
      this.sensors.set(peripheral, sensor);
      this.callbacks.onBatteryLevel?.(peripheral, batteryLevel);
    }
  }

  /**
   * Get payload mode for characteristic UUID
   */
  private getPayloadModeForCharacteristic(charUuid: string): PayloadMode {
    if (charUuid === MEASUREMENT_SHORT_PAYLOAD_CHAR_UUID) {
      return PayloadMode.ORIENTATION_QUATERNION;
    } else if (charUuid === MEASUREMENT_MEDIUM_PAYLOAD_CHAR_UUID) {
      return PayloadMode.COMPLETE_QUATERNION;
    } else {
      return PayloadMode.EXTENDED_QUATERNION;
    }
  }

  /**
   * Set callbacks for BLE events
   */
  setCallbacks(callbacks: BleServiceCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Check if BLE is available and initialized
   */
  isAvailable(): boolean {
    return this.isInitialized && this.bleManager !== null;
  }

  /**
   * Start scanning for Movella DOT sensors (react-native-ble-plx)
   * Filters by device name "Movella DOT" or "Xsens Dot" and MAC address range D4:22:CD:XX:XX:XX
   */
  async startScanning(): Promise<void> {
    console.log("🔍 [BLE] startScanning() called");
    console.log("🔍 [BLE] isAvailable():", this.isAvailable());
    console.log("🔍 [BLE] isInitialized:", this.isInitialized);
    console.log("🔍 [BLE] bleManager exists:", !!this.bleManager);
    console.log("🔍 [BLE] isScanning:", this.isScanning);
    console.log("🔍 [BLE] Platform:", Platform.OS);

    if (!this.isAvailable()) {
      const error = new Error("BLE not available. Please ensure BLE library is installed.");
      console.error("❌ [BLE] BLE not available:", error);
      throw error;
    }

    if (this.isScanning) {
      console.warn("⚠️ [BLE] Scanning already in progress");
      return;
    }

    if (!this.bleManager) {
      const error = new Error("BLE Manager instance is null");
      console.error("❌ [BLE] BLE Manager is null:", error);
      throw error;
    }

    try {
      console.log("🔍 [BLE] Checking Bluetooth state...");
      
      // Check Bluetooth state before scanning
      const state = await this.bleManager.state();
      console.log("✅ [BLE] Bluetooth state:", state);
      
      if (state !== State.PoweredOn) {
        const error = new Error(`Bluetooth is ${state}. Please enable Bluetooth in Settings.`);
        console.error("❌ [BLE] Bluetooth state invalid:", error);
        throw error;
      }

      console.log("🔍 [BLE] Setting isScanning = true");
      this.isScanning = true;

      // Stop any existing scan
      if (this.scanSubscription) {
        this.bleManager?.stopDeviceScan();
        this.scanSubscription = null;
      }

      // Start device scan using react-native-ble-plx API
      // startDeviceScan returns a subscription, not a promise
      console.log("🔍 [BLE] Starting device scan with react-native-ble-plx...");
      
      this.scanSubscription = this.bleManager.startDeviceScan(
        null, // null = scan for all devices
        null, // null = no scan options
        (error, device) => {
          if (error) {
            console.error("❌ [BLE] Scan error:", error);
            this.isScanning = false;
            this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
            return;
          }

          if (device) {
            // Handle discovered device
            this.handleDiscoveredDevice(device);
          }
        }
      );

      console.log("✅ [BLE] Scan started successfully!");
      
      // Auto-stop after 10 seconds
      setTimeout(() => {
        if (this.isScanning) {
          this.stopScanning().catch(console.error);
        }
      }, 10000);
    } catch (error) {
      this.isScanning = false;
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("❌ [BLE] Scan error:", err);
      console.error("❌ [BLE] Error stack:", err.stack);
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  /**
   * Stop scanning for sensors (react-native-ble-plx)
   */
  async stopScanning(): Promise<void> {
    if (!this.isScanning) return;

    try {
      // startDeviceScan() doesn't return a removable subscription
      // Just call stopDeviceScan() directly
      this.bleManager?.stopDeviceScan();
      this.scanSubscription = null;
      this.isScanning = false;
      console.log("✅ [BLE] Stopped scanning");
    } catch (error) {
      console.error("❌ [BLE] Error stopping scan:", error);
      this.isScanning = false;
    }
  }

  /**
   * Connect to a Movella DOT sensor (react-native-ble-plx)
   */
  async connectToSensor(sensorId: string): Promise<void> {
    if (!this.isAvailable() || !this.bleManager) {
      throw new Error("BLE not available");
    }

    const sensor = this.sensors.get(sensorId);
    if (!sensor) {
      throw new Error(`Sensor ${sensorId} not found`);
    }

    if (sensor.connected) {
      console.log(`✅ [BLE] Sensor ${sensorId} already connected`);
      return;
    }

    try {
      // Get device from cache (stored during scan)
      const bleDevice = this.deviceCache.get(sensorId);
      if (!bleDevice) {
        throw new Error(`Device ${sensorId} not found in cache. Please scan first.`);
      }
      
      // Connect to device
      console.log(`🔍 [BLE] Connecting to device ${sensorId}...`);
      await bleDevice.connect();
      
      // Wait a bit for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Discover services and characteristics
      console.log(`🔍 [BLE] Discovering services and characteristics...`);
      await bleDevice.discoverAllServicesAndCharacteristics();
      
      sensor.connected = true;
      this.sensors.set(sensorId, sensor);
      
      // Read device info and battery level
      try {
        await this.readDeviceInfo(sensorId);
        await this.readBatteryLevel(sensorId);
        await this.requestHardwareTag(sensorId);
      } catch (error) {
        console.warn(`⚠️ [BLE] Could not read device info/battery for ${sensorId}:`, error);
      }
      
      this.callbacks.onSensorConnected?.(sensorId);
      console.log(`✅ [BLE] Connected to sensor ${sensorId}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`❌ [BLE] Error connecting to sensor ${sensorId}:`, err);
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  /**
   * Disconnect from a sensor (react-native-ble-plx)
   */
  async disconnectFromSensor(sensorId: string): Promise<void> {
    if (!this.isAvailable() || !this.bleManager) return;

    const sensor = this.sensors.get(sensorId);
    if (!sensor || !sensor.connected) return;

    const device = this.deviceCache.get(sensorId);

    try {
      if (Platform.OS === "android") {
        // Android: the native cancelDeviceConnection triggers doFinally on the RxJava
        // connection Observable which can crash the app. Instead, we:
        // 1. Stop the measurement (write stop command to sensor)
        // 2. Clean up JS-side subscriptions
        // 3. Destroy and recreate BleManager to force-close all native connections
        //    without going through the crashy cancelDeviceConnection path
        this.stoppingSensors.add(sensorId);
        try {
          await this.stopMeasurement(sensorId);
        } catch (stopErr) {
          console.warn(`⚠️ [BLE] stopMeasurement before disconnect for ${sensorId}:`, stopErr);
        }
        // Wait for the sensor to process the stop command
        await new Promise((r) => setTimeout(r, 300));
        // Clean up JS-side state
        this.notificationSubscriptions.delete(sensorId);
        this.messageSubscriptions.delete(sensorId);
        this.hardwareTagResolvers.delete(sensorId);
        this.deviceCache.delete(sensorId);
        // Skip cancelDeviceConnection entirely - it crashes the app.
        // The native BLE connection will be cleaned up when the sensor times out
        // or when the BleManager is destroyed/recreated on next full reset.
        setTimeout(() => this.stoppingSensors.delete(sensorId), 1500);
      } else {
        await this.stopMeasurement(sensorId);
        const subscription = this.notificationSubscriptions.get(sensorId);
        if (subscription) {
          subscription.remove();
          this.notificationSubscriptions.delete(sensorId);
        }
        const messageSubscription = this.messageSubscriptions.get(sensorId);
        if (messageSubscription) {
          try {
            messageSubscription.remove();
          } catch (removeError) {
            console.log(`ℹ️ [BLE] Message subscription removal note for ${sensorId}:`, removeError);
          }
          this.messageSubscriptions.delete(sensorId);
        }
        this.hardwareTagResolvers.delete(sensorId);
        if (device) {
          await device.cancelConnection();
        }
      }
      
      sensor.connected = false;
      this.sensors.set(sensorId, sensor);
      
      // Defer callback (avoids Android crash - let native layer fully settle before React state updates)
      if (Platform.OS === "android") {
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            this.callbacks.onSensorDisconnected?.(sensorId);
          }, 400);
        });
      } else {
        this.callbacks.onSensorDisconnected?.(sensorId);
      }
      console.log(`✅ [BLE] Disconnected from sensor ${sensorId}`);
    } catch (error) {
      console.error(`❌ [BLE] Error disconnecting from sensor ${sensorId}:`, error);
    }
  }

  /**
   * Read device information from Configuration Service (react-native-ble-plx)
   */
  async readDeviceInfo(sensorId: string): Promise<void> {
    if (!this.isAvailable() || !this.bleManager) return;

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      console.warn(`Device ${sensorId} not found in cache`);
      return;
    }

    try {
      const serviceUUID = getFullUuid(CONFIGURATION_SERVICE_UUID);
      const charUUID = getFullUuid(DEVICE_INFO_CHAR_UUID);
      
      const characteristic = await device.readCharacteristicForService(serviceUUID, charUUID);
      const value = characteristic.value;
      
      if (!value) {
        console.warn(`No value received for device info on ${sensorId}`);
        return;
      }

      // Parse device info: MAC (6 bytes) + Firmware (3 bytes) + Build date (7 bytes) + SoftDevice (4 bytes) + Serial (8 bytes) + Product (6 bytes)
      const buffer = base64ToUint8Array(value);
      const sensor = this.sensors.get(sensorId);
      
      if (sensor && buffer.length >= 17) {
        // Parse firmware version (bytes 6-8)
        const major = buffer[6];
        const minor = buffer[7];
        const revision = buffer[8];
        sensor.firmwareVersion = `${major}.${minor}.${revision}`;
        
        // Parse serial number (bytes 17-24)
        if (buffer.length >= 25) {
          const serialBytes = buffer.slice(17, 25);
          sensor.serialNumber = Array.from(serialBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }
        
        this.sensors.set(sensorId, sensor);
        console.log(`✅ [BLE] Device info read for ${sensorId}: FW ${sensor.firmwareVersion}`);
      }
    } catch (error) {
      console.error(`❌ [BLE] Error reading device info for ${sensorId}:`, error);
    }
  }

  /**
   * Read battery level from Battery Service (react-native-ble-plx)
   */
  async readBatteryLevel(sensorId: string): Promise<void> {
    if (!this.isAvailable() || !this.bleManager) return;

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      console.warn(`Device ${sensorId} not found in cache`);
      return;
    }

    try {
      const serviceUUID = getFullUuid(BATTERY_SERVICE_UUID);
      const charUUID = getFullUuid(BATTERY_CHAR_UUID);
      
      const characteristic = await device.readCharacteristicForService(serviceUUID, charUUID);
      const value = characteristic.value;
      
      if (!value) {
        console.warn(`No value received for battery level on ${sensorId}`);
        return;
      }

      const buffer = base64ToUint8Array(value);
      const batteryLevel = buffer[0];
      
      const sensor = this.sensors.get(sensorId);
      if (sensor) {
        sensor.batteryLevel = batteryLevel;
        this.sensors.set(sensorId, sensor);
        this.callbacks.onBatteryLevel?.(sensorId, batteryLevel);
        console.log(`✅ [BLE] Battery level for ${sensorId}: ${batteryLevel}%`);
      }
    } catch (error) {
      console.error(`❌ [BLE] Error reading battery level for ${sensorId}:`, error);
    }
  }

  /**
   * Ensure message notification subscription is active for configuration responses
   */
  private async ensureMessageNotification(sensorId: string): Promise<void> {
    if (!this.isAvailable() || !this.bleManager) return;
    if (this.messageSubscriptions.has(sensorId)) return;

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      throw new Error(`Device ${sensorId} not found in cache`);
    }

    const serviceUUID = getFullUuid(MESSAGE_SERVICE_UUID);
    const notifyUUID = getFullUuid(MESSAGE_NOTIFICATION_CHAR_UUID);

    const subscription = device.monitorCharacteristicForService(
      serviceUUID,
      notifyUUID,
      (error, characteristic) => {
        if (error) {
          console.error(`❌ [BLE] Message notification error for ${sensorId}:`, error);
          return;
        }

        if (!characteristic?.value) {
          return;
        }

        try {
          const payload = base64ToUint8Array(characteristic.value);
          if (payload.length < 2) {
            return;
          }

          const mid = payload[0];
          const length = payload[1];
          const availableLength = Math.min(length, payload.length - 2);
          if (availableLength <= 0) {
            return;
          }

          const data = payload.slice(2, 2 + availableLength);

          let tagBytes: Uint8Array | null = null;
          if (mid === 0x03) {
            if (data[0] === 0x02 && data.length > 1) {
              // Format with ConfigAckID followed by payload
              tagBytes = data.slice(1);
            } else {
              tagBytes = data;
            }
          }

          if (tagBytes) {
            const tag = String.fromCharCode(...Array.from(tagBytes)).replace(/\0+$/, '');
            console.log(`✅ [BLE] Hardware device tag for ${sensorId}: ${tag}`);

            const sensor = this.sensors.get(sensorId);
            if (sensor) {
              sensor.hardwareDeviceTag = tag;
              this.sensors.set(sensorId, sensor);
            }

            const resolver = this.hardwareTagResolvers.get(sensorId);
            if (resolver) {
              this.hardwareTagResolvers.delete(sensorId);
              resolver(tag);
            } else {
              // Trigger UI update even if no pending promise
              this.callbacks.onSensorConnected?.(sensorId);
            }
          }
        } catch (parseError) {
          console.error(`❌ [BLE] Error parsing message notification for ${sensorId}:`, parseError);
        }
      }
    );

    this.messageSubscriptions.set(sensorId, subscription);
  }

  /**
   * Request hardware device tag stored on Movella DOT
   */
  private async requestHardwareTag(sensorId: string): Promise<string | null> {
    if (!this.isAvailable() || !this.bleManager) return null;

    try {
      await this.ensureMessageNotification(sensorId);
    } catch (error) {
      console.warn(`⚠️ [BLE] Could not ensure message notification for ${sensorId}:`, error);
      return null;
    }

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      console.warn(`⚠️ [BLE] Device ${sensorId} not found in cache for hardware tag request`);
      return null;
    }

    const serviceUUID = getFullUuid(MESSAGE_SERVICE_UUID);
    const controlUUID = getFullUuid(MESSAGE_CONTROL_CHAR_UUID);

    const message = new Uint8Array([0x03, 0x01, 0x02, 0xFA]); // MID, LEN, ConfigID(RequestTag), CHECKSUM

    const tag = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.hardwareTagResolvers.has(sensorId)) {
          console.warn(`⚠️ [BLE] Hardware device tag request timed out for ${sensorId}`);
          this.hardwareTagResolvers.delete(sensorId);
          resolve(null);
        }
      }, 3000);

      const resolver = (tag: string | null) => {
        clearTimeout(timeout);
        resolve(tag);
      };

      this.hardwareTagResolvers.set(sensorId, resolver);

      device.writeCharacteristicWithResponseForService(
        serviceUUID,
        controlUUID,
        uint8ArrayToBase64(message)
      ).catch((error) => {
        console.error(`❌ [BLE] Error requesting hardware tag for ${sensorId}:`, error);
        if (this.hardwareTagResolvers.has(sensorId)) {
          this.hardwareTagResolvers.delete(sensorId);
          clearTimeout(timeout);
          resolve(null);
        }
      });
    });

    if (tag) {
      const sensor = this.sensors.get(sensorId);
      if (sensor) {
        sensor.hardwareDeviceTag = tag;
        this.sensors.set(sensorId, sensor);
      }
      this.callbacks.onSensorConnected?.(sensorId);
    }

    return tag;
  }

  /**
   * Configure device settings (react-native-ble-plx)
   */
  async configureDevice(
    sensorId: string,
    options: {
      outputRate?: number; // Hz: 1, 4, 10, 12, 15, 20, 30, 60, 120
      filterProfile?: number; // 0 = General, 1 = Dynamic
      deviceTag?: string; // Max 16 characters
    }
  ): Promise<void> {
    if (!this.isAvailable() || !this.bleManager) return;

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      console.warn(`Device ${sensorId} not found in cache`);
      return;
    }

    try {
      const serviceUUID = getFullUuid(CONFIGURATION_SERVICE_UUID);
      const charUUID = getFullUuid(DEVICE_CONTROL_CHAR_UUID);
      
      // Build 32-byte configuration buffer
      const buffer = new Uint8Array(32);
      let offset = 0;
      
      // Visit Index (bitmask)
      if (options.outputRate !== undefined || options.filterProfile !== undefined || options.deviceTag !== undefined) {
        buffer[offset++] = 0x30; // Enable bits for output rate, filter profile, and tag
      }
      
      // Power off/power saving (skip)
      offset += 2;
      
      // Device Tag
      if (options.deviceTag) {
        const tagBytes = new TextEncoder().encode(options.deviceTag);
        buffer[offset++] = Math.min(tagBytes.length, 16);
        buffer.set(tagBytes.slice(0, 16), offset);
        offset += 16;
      } else {
        offset += 17; // Skip tag length + tag
      }
      
      // Output Rate (2 bytes, little-endian)
      if (options.outputRate !== undefined) {
        const rate = Math.min(Math.max(options.outputRate, 1), 120);
        buffer[offset] = rate & 0xff;
        buffer[offset + 1] = (rate >> 8) & 0xff;
        offset += 2;
      } else {
        offset += 2;
      }
      
      // Filter Profile Index (1 byte)
      if (options.filterProfile !== undefined) {
        buffer[offset++] = options.filterProfile;
      }
      
      // Write configuration
      const base64Value = uint8ArrayToBase64(buffer);
      await device.writeCharacteristicWithResponseForService(
        serviceUUID,
        charUUID,
        base64Value
      );
      
      console.log(`✅ [BLE] Configured device ${sensorId}`);
    } catch (error) {
      console.error(`❌ [BLE] Error configuring device ${sensorId}:`, error);
      throw error;
    }
  }

  /**
   * Start measurement with specified payload mode (react-native-ble-plx)
   */
  async startMeasurement(
    sensorId: string,
    payloadMode: PayloadMode = PayloadMode.EXTENDED_QUATERNION
  ): Promise<void> {
    console.log(`🔵 [BLE] startMeasurement() called for ${sensorId}, payloadMode: ${payloadMode}`);
    
    if (!this.isAvailable() || !this.bleManager) {
      console.error(`❌ [BLE] BLE not available or manager is null`);
      return;
    }

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      console.error(`❌ [BLE] Device ${sensorId} not found in cache. Cache size: ${this.deviceCache.size}`);
      throw new Error(`Device ${sensorId} not found in cache`);
    }
    
    console.log(`✅ [BLE] Device found in cache for ${sensorId}`);

    try {
      // Enable notifications first
      console.log(`📡 [BLE] Enabling notifications for ${sensorId} before starting measurement...`);
      await this.enableMeasurementNotifications(sensorId, payloadMode);
      
      const serviceUUID = getFullUuid(MEASUREMENT_SERVICE_UUID);
      const charUUID = getFullUuid(MEASUREMENT_CONTROL_CHAR_UUID);
      
      console.log(`📝 [BLE] Service UUID: ${serviceUUID}`);
      console.log(`📝 [BLE] Control Characteristic UUID: ${charUUID}`);
      
      // Build control message: [Type=1, Action=1 (start), PayloadMode]
      const controlBuffer = new Uint8Array([0x01, 0x01, payloadMode]);
      const base64Value = uint8ArrayToBase64(controlBuffer);
      
      console.log(`📝 [BLE] Control message buffer (hex): ${bufferToHex(controlBuffer, 10)}`);
      console.log(`📝 [BLE] Control message base64: ${base64Value}`);
      console.log(`📝 [BLE] Writing control characteristic to ${sensorId}...`);
      
      // Write control characteristic
      await device.writeCharacteristicWithResponseForService(
        serviceUUID,
        charUUID,
        base64Value
      );
      
      console.log(`✅ [BLE] Control message written successfully to ${sensorId}`);
      console.log(`✅ [BLE] Started measurement on ${sensorId} with payload mode ${payloadMode}`);
      
      // Start heartbeat logging
      this.startHeartbeatLogging(sensorId);
    } catch (error) {
      console.error(`❌ [BLE] Error starting measurement on ${sensorId}:`, error);
      console.error(`❌ [BLE] Error details:`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  /**
   * Stop measurement (react-native-ble-plx)
   */
  async stopMeasurement(sensorId: string): Promise<void> {
    console.log(`🛑 [BLE] stopMeasurement() called for ${sensorId}`);
    
    if (!this.isAvailable() || !this.bleManager) {
      console.warn(`⚠️ [BLE] BLE not available or manager is null`);
      return;
    }

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      console.warn(`⚠️ [BLE] Device ${sensorId} not found in cache`);
      return;
    }

    try {
      // Stop heartbeat logging
      this.stopHeartbeatLogging(sensorId);
      
      // Mark sensor as stopping to ignore cancellation errors
      this.stoppingSensors.add(sensorId);
      
      const serviceUUID = getFullUuid(MEASUREMENT_SERVICE_UUID);
      const charUUID = getFullUuid(MEASUREMENT_CONTROL_CHAR_UUID);
      
      // Build control message: [Type=1, Action=0 (stop), PayloadMode=0]
      const controlBuffer = new Uint8Array([0x01, 0x00, 0x00]);
      const base64Value = uint8ArrayToBase64(controlBuffer);
      
      console.log(`📝 [BLE] Stop control message buffer (hex): ${bufferToHex(controlBuffer, 10)}`);
      console.log(`📝 [BLE] Writing stop control message to ${sensorId}...`);
      
      // Write stop command first so sensor stops streaming before we remove subscription (reduces Android crash risk)
      await device.writeCharacteristicWithResponseForService(
        serviceUUID,
        charUUID,
        base64Value
      );
      
      // On Android, wait for sensor to stop streaming
      if (Platform.OS === "android") {
        await new Promise((r) => setTimeout(r, 150));
      }
      
      // Remove notification subscription. On Android, skip subscription.remove() - it can crash.
      // Per react-native-ble-plx#1281: subscriptions are auto-cleaned when device disconnects.
      const subscription = this.notificationSubscriptions.get(sensorId);
      if (subscription) {
        if (Platform.OS !== "android") {
          try {
            subscription.remove();
          } catch (removeError) {
            console.log(`ℹ️ [BLE] Subscription removal note for ${sensorId}:`, removeError);
          }
        } else {
          console.log(`🛑 [BLE] Skipping subscription.remove() on Android (auto-cleanup on disconnect)`);
        }
        this.notificationSubscriptions.delete(sensorId);
      }
      
      console.log(`✅ [BLE] Stopped measurement on ${sensorId}`);
    } catch (error) {
      console.error(`❌ [BLE] Error stopping measurement on ${sensorId}:`, error);
      console.error(`❌ [BLE] Error details:`, error instanceof Error ? error.stack : String(error));
    } finally {
      // Remove from stopping set after a short delay to allow cancellation errors to be ignored
      setTimeout(() => {
        this.stoppingSensors.delete(sensorId);
      }, 1000);
    }
  }

  /**
   * Start periodic heartbeat logging for active measurement
   */
  private startHeartbeatLogging(sensorId: string): void {
    // Clear existing interval if any
    const existingInterval = this.heartbeatIntervals.get(sensorId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }
    
    // Log heartbeat every 2 seconds
    const interval = setInterval(() => {
      const sensor = this.sensors.get(sensorId);
      if (sensor && sensor.connected) {
        console.log(`💓 [BLE] Measurement active, waiting for data from ${sensorId}...`);
      } else {
        clearInterval(interval);
        this.heartbeatIntervals.delete(sensorId);
      }
    }, 2000);
    
    this.heartbeatIntervals.set(sensorId, interval);
  }

  /**
   * Stop heartbeat logging
   */
  private stopHeartbeatLogging(sensorId: string): void {
    const interval = this.heartbeatIntervals.get(sensorId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(sensorId);
    }
  }

  /**
   * Enable notifications for measurement data (react-native-ble-plx)
   */
  private async enableMeasurementNotifications(
    sensorId: string,
    payloadMode: PayloadMode
  ): Promise<void> {
    console.log(`📡 [BLE] enableMeasurementNotifications() called for ${sensorId}, payloadMode: ${payloadMode}`);
    
    if (!this.isAvailable() || !this.bleManager) {
      console.error(`❌ [BLE] BLE not available or manager is null`);
      return;
    }

    const device = this.deviceCache.get(sensorId);
    if (!device) {
      console.error(`❌ [BLE] Device ${sensorId} not found in cache`);
      throw new Error(`Device ${sensorId} not found in cache`);
    }

    try {
      const serviceUUID = getFullUuid(MEASUREMENT_SERVICE_UUID);
      
      // Determine which payload characteristic to use based on payload mode
      // Reference: Table 15 (Medium payload) - Extended & Complete Quaternion use characteristic 0x2003 (36/32 bytes)
      let charUUID: string;
      let payloadChannelLabel = '';
      if (payloadMode === PayloadMode.ORIENTATION_QUATERNION) {
        charUUID = getFullUuid(MEASUREMENT_SHORT_PAYLOAD_CHAR_UUID); // 0x2004 - <=20 bytes
        payloadChannelLabel = 'SHORT payload characteristic (0x2004)';
      } else if (
        payloadMode === PayloadMode.EXTENDED_QUATERNION ||
        payloadMode === PayloadMode.COMPLETE_QUATERNION
      ) {
        charUUID = getFullUuid(MEASUREMENT_MEDIUM_PAYLOAD_CHAR_UUID); // 0x2003 - 21..40 bytes
        payloadChannelLabel = 'MEDIUM payload characteristic (0x2003)';
      } else {
        charUUID = getFullUuid(MEASUREMENT_LONG_PAYLOAD_CHAR_UUID); // 0x2002 - >40 bytes
        payloadChannelLabel = 'LONG payload characteristic (0x2002)';
      }
      console.log(`📡 [BLE] Using ${payloadChannelLabel} for payload mode ${payloadMode}`);
      
      console.log(`📡 [BLE] Service UUID: ${serviceUUID}`);
      console.log(`📡 [BLE] Characteristic UUID: ${charUUID}`);
      
      // Remove existing subscription if any
      const existingSubscription = this.notificationSubscriptions.get(sensorId);
      if (existingSubscription) {
        console.log(`📡 [BLE] Removing existing subscription for ${sensorId}`);
        existingSubscription.remove();
      }
      
      console.log(`📡 [BLE] Calling monitorCharacteristicForService for ${sensorId}...`);
      
      // Monitor characteristic for notifications
      const subscription = device.monitorCharacteristicForService(
        serviceUUID,
        charUUID,
        (error, characteristic) => {
          // Log EVERY callback invocation
          const timestamp = new Date().toISOString();
          console.log(`📦 [BLE] Notification callback invoked for ${sensorId} at ${timestamp}`);
          
          if (error) {
            // Ignore "Operation was cancelled" / disconnect errors when intentionally stopping
            const isCancellationError = 
              error.message?.includes('Operation was cancelled') ||
              error.message?.includes('cancelled') ||
              error.code === 'OperationCancelled';
            const isDisconnectError =
              error.message?.includes('Device disconnected') ||
              error.message?.includes('disconnected') ||
              error.message?.includes('Connection lost') ||
              error.message?.includes('GATT_ERROR');
            
            if ((isCancellationError || isDisconnectError) && this.stoppingSensors.has(sensorId)) {
              console.log(`ℹ️ [BLE] Notification cancelled/disconnect for ${sensorId} (expected)`);
              return;
            }
            
            // Unexpected disconnect (e.g. user turned off sensor): update state and notify
            if (isDisconnectError) {
              const sensor = this.sensors.get(sensorId);
              if (sensor?.connected) {
                sensor.connected = false;
                this.sensors.set(sensorId, sensor);
                this.notificationSubscriptions.delete(sensorId);
                this.messageSubscriptions.delete(sensorId);
                const sid = sensorId;
                const safeNotify = () => this.callbacks.onSensorDisconnected?.(sid);
                if (Platform.OS === "android") {
                  InteractionManager.runAfterInteractions(() => setTimeout(safeNotify, 300));
                } else {
                  safeNotify();
                }
              }
              // Don't fire onError for disconnect - the onSensorDisconnected callback
              // already handles the UI update. Showing an error alert is confusing.
              console.log(`ℹ️ [BLE] Unexpected disconnect for ${sensorId} (handled via onSensorDisconnected)`);
              return;
            }
            
            // Genuine error (not disconnect-related): report to UI
            const reportError = () => {
              console.error(`❌ [BLE] Notification error for ${sensorId}:`, error);
              this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
            };
            if (Platform.OS === "android") {
              InteractionManager.runAfterInteractions(() => setTimeout(reportError, 100));
            } else {
              reportError();
            }
            return;
          }

          // Log characteristic details
          if (characteristic) {
            console.log(`📦 [BLE] Characteristic received for ${sensorId}:`);
            console.log(`📦 [BLE]   - UUID: ${characteristic.uuid}`);
            console.log(`📦 [BLE]   - Value length: ${characteristic.value ? characteristic.value.length : 0}`);
            console.log(`📦 [BLE]   - IsNotifying: ${characteristic.isNotifying}`);
            console.log(`📦 [BLE]   - ServiceUUID: ${characteristic.serviceUUID}`);
          } else {
            console.warn(`⚠️ [BLE] Characteristic is null for ${sensorId}`);
          }

          if (characteristic?.value) {
            console.log(`📦 [BLE] Processing data from ${sensorId}, base64 length: ${characteristic.value.length}`);
            const buffer = base64ToUint8Array(characteristic.value);
            console.log(`📦 [BLE] Buffer created, length: ${buffer.length} bytes`);
            console.log(`📦 [BLE] Raw buffer (hex, first 20 bytes): ${bufferToHex(buffer, 20)}`);
            this.handleMeasurementData(sensorId, buffer, payloadMode);
          } else {
            console.warn(`⚠️ [BLE] No value in characteristic for ${sensorId}`);
          }
        }
      );
      
      console.log(`📡 [BLE] Subscription created for ${sensorId}, type: ${typeof subscription}`);
      console.log(`📡 [BLE] Notification callback registered for ${sensorId}`);
      
      this.notificationSubscriptions.set(sensorId, subscription);
      console.log(`✅ [BLE] Enabled notifications for ${sensorId} (payload mode ${payloadMode})`);
    } catch (error) {
      console.error(`❌ [BLE] Error enabling notifications for ${sensorId}:`, error);
      console.error(`❌ [BLE] Error details:`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  /**
   * Handle incoming measurement data and convert to Fusion format
   */
  private handleMeasurementData(
    sensorId: string,
    buffer: Uint8Array,
    payloadMode: PayloadMode
  ): void {
    console.log(`📊 [BLE] handleMeasurementData() called for ${sensorId}`);
    console.log(`📊 [BLE] Buffer length: ${buffer.length} bytes, payloadMode: ${payloadMode}`);
    console.log(`📊 [BLE] Buffer hex (first 20 bytes): ${bufferToHex(buffer, 20)}`);
    
    try {
      const sensor = this.sensors.get(sensorId);
      if (!sensor || !sensor.connected) {
        console.warn(`⚠️ [BLE] Sensor ${sensorId} not found or not connected`);
        return;
      }

      let offset = 0;
      
      // Parse timestamp (4 bytes, little-endian, microseconds)
      const timestamp = readUint32LE(buffer, offset);
      offset += 4;
      console.log(`📊 [BLE] Parsed timestamp: ${timestamp} (${timestamp / 1000000}s)`);
      
      // Parse quaternion (16 bytes, w,x,y,z floats, little-endian)
      const quaternion = parseQuaternion(buffer, offset);
      offset += 16;
      console.log(`📊 [BLE] Parsed quaternion: w=${quaternion.w.toFixed(4)}, x=${quaternion.x.toFixed(4)}, y=${quaternion.y.toFixed(4)}, z=${quaternion.z.toFixed(4)}`);
      
      // Parse free acceleration (12 bytes, x,y,z floats, little-endian) - only in EXTENDED_QUATERNION
      let freeAcc = { x: 0, y: 0, z: 0 };
      let status = 0;
      
      if (payloadMode === PayloadMode.EXTENDED_QUATERNION && buffer.length >= 36) {
        freeAcc.x = readFloatLE(buffer, offset);
        freeAcc.y = readFloatLE(buffer, offset + 4);
        freeAcc.z = readFloatLE(buffer, offset + 8);
        offset += 12;
        
        // Status byte
        status = buffer[offset];
        console.log(`📊 [BLE] Parsed freeAcc: x=${freeAcc.x.toFixed(4)}, y=${freeAcc.y.toFixed(4)}, z=${freeAcc.z.toFixed(4)}`);
        console.log(`📊 [BLE] Parsed status: ${status} (0x${status.toString(16)})`);
        // Clipping counts (3 bytes) follow but we don't need them for CSV
      } else if (payloadMode === PayloadMode.COMPLETE_QUATERNION && buffer.length >= 32) {
        freeAcc.x = readFloatLE(buffer, offset);
        freeAcc.y = readFloatLE(buffer, offset + 4);
        freeAcc.z = readFloatLE(buffer, offset + 8);
        offset += 12;
        console.log(`📊 [BLE] Parsed freeAcc: x=${freeAcc.x.toFixed(4)}, y=${freeAcc.y.toFixed(4)}, z=${freeAcc.z.toFixed(4)}`);
      }
      
      // Convert quaternion to Euler angles (ZYX intrinsic)
      const euler = quaternionToEulerZYX(quaternion.w, quaternion.x, quaternion.y, quaternion.z);
      console.log(`📊 [BLE] Converted to Euler: x=${euler.x.toFixed(2)}°, y=${euler.y.toFixed(2)}°, z=${euler.z.toFixed(2)}°`);
      
      // Create MeasurementData for legacy callback
      const measurementData: MeasurementData = {
        timestamp,
        quaternion,
        deviceTag: sensor.deviceTag || DeviceTag.RIGHT_THIGH,
      };
      
      console.log(`📤 [BLE] Calling onMeasurementData callback for ${sensorId}`);
      this.callbacks.onMeasurementData?.(sensorId, measurementData);
      
      // Create FusionMeasurementData for CSV export
      // Note: PacketCounter and SampleTimeFine will be set by the caller (BleConnectionScreen)
      const fusionData: FusionMeasurementData = {
        PacketCounter: 0, // Will be set by caller
        SampleTimeFine: timestamp, // Will be adjusted relative to start time by caller
        Euler_X: euler.x,
        Euler_Y: euler.y,
        Euler_Z: euler.z,
        FreeAcc_X: freeAcc.x,
        FreeAcc_Y: freeAcc.y,
        FreeAcc_Z: freeAcc.z,
        Status: status,
      };
      
      console.log(`📤 [BLE] Calling onFusionMeasurementData callback for ${sensorId}`);
      console.log(`📤 [BLE] Fusion data: PacketCounter=${fusionData.PacketCounter}, SampleTimeFine=${fusionData.SampleTimeFine}, Euler=[${fusionData.Euler_X.toFixed(2)}, ${fusionData.Euler_Y.toFixed(2)}, ${fusionData.Euler_Z.toFixed(2)}]`);
      this.callbacks.onFusionMeasurementData?.(sensorId, fusionData);
      console.log(`✅ [BLE] Successfully processed measurement data from ${sensorId}`);
    } catch (error) {
      console.error(`❌ [BLE] Error parsing measurement data from ${sensorId}:`, error);
      console.error(`❌ [BLE] Error details:`, error instanceof Error ? error.stack : String(error));
      console.error(`❌ [BLE] Buffer length: ${buffer.length}, payloadMode: ${payloadMode}`);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Assign device tag to sensor (for sensor mapping)
   */
  setDeviceTag(sensorId: string, deviceTag: DeviceTag): void {
    const sensor = this.sensors.get(sensorId);
    if (sensor) {
      sensor.deviceTag = deviceTag;
      this.sensors.set(sensorId, sensor);
    }
  }

  /**
   * Get all discovered sensors
   */
  getSensors(): MovellaSensor[] {
    return Array.from(this.sensors.values());
  }

  /**
   * Get connected sensors
   */
  getConnectedSensors(): MovellaSensor[] {
    return Array.from(this.sensors.values()).filter((s) => s.connected);
  }

  /**
   * Clear all sensors
   */
  clearSensors(): void {
    this.sensors.clear();
  }
}

// Singleton instance
let bleServiceInstance: MovellaBleService | null = null;

/**
 * Get or create Movella BLE service instance
 */
export function getMovellaBleService(): MovellaBleService {
  if (!bleServiceInstance) {
    bleServiceInstance = new MovellaBleService();
  }
  return bleServiceInstance;
}

