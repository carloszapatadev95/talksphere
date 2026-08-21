import React from 'react';
import { render } from '@testing-library/react-native';
import TypingIndicator from '../../src/components/TypingIndicator';

describe('TypingIndicator', () => {
  it('renders without crashing', () => {
    const { getByText } = render(<TypingIndicator />);
    expect(getByText(/escribiendo/)).toBeTruthy();
  });

  it('shows typing text', () => {
    const { getByText } = render(<TypingIndicator />);
    expect(getByText(/escribiendo/)).toBeTruthy();
  });
});
