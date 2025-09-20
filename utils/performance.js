const os = require('os');
const fs = require('fs');
const path = require('path');

class PerformanceMonitor {
  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      requests: 0,
      errors: 0,
      avgResponseTime: 0,
      memoryUsage: [],
      cpuUsage: []
    };
    
    // Start monitoring
    this.startMonitoring();
  }

  startMonitoring() {
    // Monitor every 30 seconds
    setInterval(() => {
      this.collectMetrics();
    }, 30000);
  }

  collectMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.metrics.memoryUsage.push({
      timestamp: Date.now(),
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external
    });
    
    this.metrics.cpuUsage.push({
      timestamp: Date.now(),
      user: cpuUsage.user,
      system: cpuUsage.system
    });
    
    // Keep only last 100 entries
    if (this.metrics.memoryUsage.length > 100) {
      this.metrics.memoryUsage = this.metrics.memoryUsage.slice(-100);
    }
    
    if (this.metrics.cpuUsage.length > 100) {
      this.metrics.cpuUsage = this.metrics.cpuUsage.slice(-100);
    }
  }

  recordRequest(responseTime) {
    this.metrics.requests++;
    
    // Calculate rolling average response time
    const totalTime = this.metrics.avgResponseTime * (this.metrics.requests - 1) + responseTime;
    this.metrics.avgResponseTime = totalTime / this.metrics.requests;
  }

  recordError() {
    this.metrics.errors++;
  }

  getSystemInfo() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      cpus: os.cpus().length,
      loadavg: os.loadavg(),
      nodeVersion: process.version,
      pid: process.pid,
      uptime: process.uptime()
    };
  }

  getMetrics() {
    const currentMem = process.memoryUsage();
    const systemInfo = this.getSystemInfo();
    
    return {
      ...this.metrics,
      currentMemory: currentMem,
      systemInfo,
      uptime: Date.now() - this.startTime,
      errorRate: this.metrics.requests > 0 ? (this.metrics.errors / this.metrics.requests) * 100 : 0
    };
  }

  getHealthStatus() {
    const metrics = this.getMetrics();
    const currentMem = metrics.currentMemory;
    const systemInfo = metrics.systemInfo;
    
    const issues = [];
    
    // Check memory usage
    const memoryUsagePercent = (currentMem.heapUsed / currentMem.heapTotal) * 100;
    if (memoryUsagePercent > 90) {
      issues.push('High memory usage');
    }
    
    // Check error rate
    if (metrics.errorRate > 5) {
      issues.push('High error rate');
    }
    
    // Check response time
    if (metrics.avgResponseTime > 5000) {
      issues.push('Slow response times');
    }
    
    // Check system load
    const loadAvg = systemInfo.loadavg[0];
    const cpuCount = systemInfo.cpus;
    if (loadAvg > cpuCount * 0.8) {
      issues.push('High system load');
    }
    
    return {
      status: issues.length === 0 ? 'healthy' : 'warning',
      issues,
      metrics: {
        memoryUsagePercent: Math.round(memoryUsagePercent * 100) / 100,
        errorRate: Math.round(metrics.errorRate * 100) / 100,
        avgResponseTime: Math.round(metrics.avgResponseTime),
        systemLoad: Math.round(loadAvg * 100) / 100
      }
    };
  }

  // Export metrics to file
  exportMetrics() {
    const metrics = this.getMetrics();
    const timestamp = new Date().toISOString();
    const filename = `metrics-${timestamp.split('T')[0]}.json`;
    const filepath = path.join(__dirname, '../logs', filename);
    
    try {
      fs.writeFileSync(filepath, JSON.stringify(metrics, null, 2));
      return filepath;
    } catch (error) {
      console.error('Failed to export metrics:', error);
      return null;
    }
  }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = performanceMonitor;
