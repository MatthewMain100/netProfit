import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function ChartPreview({ rows, metric }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const labels = rows.slice(0, 20).map((r, i) => r.date || r.project || r.category || `#${i + 1}`);
    const values = rows.slice(0, 20).map(r => Number(r[metric] || r.count || r.sum_amount || 0));

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: metric, data: values, backgroundColor: '#1f1f1f' }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
      },
    });

    return () => chartRef.current?.destroy();
  }, [rows, metric]);

  return (
    <div className="panel">
      <h2>Chart Preview</h2>
      <canvas ref={canvasRef} height="120" />
    </div>
  );
}
