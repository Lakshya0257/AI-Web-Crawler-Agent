import { Socket } from "socket.io";

/**
 * Interface for web exploration functionality
 */
export interface IExplorer {
  /**
   * Start the exploration process
   * @param maxPagesToExplore - Maximum number of pages to explore
   * @returns Promise that resolves to true if objective achieved, false otherwise
   */
  explore(maxPagesToExplore?: number): Promise<boolean>;
  
  /**
   * Finalize the exploration session
   * @param objectiveAchieved - Whether the objective was achieved
   * @returns Promise that resolves to the final result
   */
  finalizeSession(objectiveAchieved: boolean): Promise<boolean>;
} 