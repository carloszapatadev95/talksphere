import { useRef, useState } from 'react';
import { View, PanResponder, Animated, Dimensions, StyleSheet, LayoutChangeEvent } from 'react-native';

interface Props {
  children: React.ReactNode;
  initialPosition?: { top: number; right: number };
  width?: number;
  height?: number;
}

export default function DraggableView({ children, initialPosition, width = 120, height = 180 }: Props) {
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastOffset = useRef({ x: 0, y: 0 });
  const initialPos = initialPosition || { top: 100, right: 16 };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({ x: lastOffset.current.x, y: lastOffset.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        lastOffset.current = { x: (pan.x as any)._value, y: (pan.y as any)._value };

        const size = containerSizeRef.current;
        const maxX = size.width - width - initialPos.right;
        const maxY = size.height - height - 20;
        const clampedX = Math.max(-initialPos.right, Math.min(maxX, lastOffset.current.x));
        const clampedY = Math.max(-initialPos.top, Math.min(maxY, lastOffset.current.y));
        if (clampedX !== lastOffset.current.x || clampedY !== lastOffset.current.y) {
          lastOffset.current = { x: clampedX, y: clampedY };
          pan.setOffset({ x: clampedX, y: clampedY });
          pan.setValue({ x: 0, y: 0 });
        }
      },
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    containerSizeRef.current = { width: w, height: h };
  };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} onLayout={onLayout} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.videoBox,
          { width, height, top: initialPos.top, right: initialPos.right },
          { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
        ]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  videoBox: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
  },
});