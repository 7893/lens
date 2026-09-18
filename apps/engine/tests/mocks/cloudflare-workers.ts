export interface MockSpan {
  isTraced: boolean;
  setAttribute: (key: string, value?: boolean | number | string) => void;
  end: () => void;
}

export const tracing = {
  enterSpan: <T>(name: string, callback: (span: MockSpan) => T): T => {
    const span: MockSpan = {
      isTraced: true,
      setAttribute: () => {},
      end: () => {},
    };
    return callback(span);
  },
  startActiveSpan: <T>(name: string, callback: (span: MockSpan) => T): T => {
    const span: MockSpan = {
      isTraced: true,
      setAttribute: () => {},
      end: () => {},
    };
    return callback(span);
  },
};
