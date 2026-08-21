import { registerRootComponent } from 'expo';

import App from './App';
import { registerCallBackgroundTask } from './src/services/backgroundNotifications';

// Se registra en module scope (early import) para que expo-task-manager pueda
// ejecutar el task headless cuando la app está en segundo plano o cerrada.
registerCallBackgroundTask();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
