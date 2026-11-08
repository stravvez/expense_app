// App entry. Replaces "expo-router/entry" as package.json "main" so the home-screen widget's
// handler is registered even when Android starts the JS without opening any screen.
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/taskHandler';

registerWidgetTaskHandler(widgetTaskHandler);
