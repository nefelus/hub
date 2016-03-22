  - When a machine is in SETUP state should be terminated as soon as it has been launched otherwise the
    termination should be postponed.
  - Be restrictive when checking permissions to use allocated resources.
  - Allow a machine to be Terminated while it is in SETUP state.
  - Set session status to CLOSING after RUNNING
  - Store in DB LOCAL_IP and PUBLIC_DNS for each session
###Version 1.1.4
  - log remoteAddress on new connections and disconnects
  - use new methods to get images
  - use new methods to find and populate NFS shares
  - pass signatureVersion to custom endpoints
  - load NFS shares from MySQL
  - If RunInstances return ResourceLimitExceeded delay some cycles until retry.
    number of cycles is set in config with skipCycles parameter.
  - Pass xterm param to master to enable access to xterm application
  - awssum library replaced by aws-sdk
  - update SERVERNAME with VM hostname (pending)
  - load machine info from database
  - check quotas in order to serve a pending job
  - Introduced QueueQuotas (load quotas from database)
  - Introduced QueueStats (gather statistics of current machine usage)
  - Retry to start a machine if RunInstances return ResourceLimitExceeded
  - Pass vncLocalOnly param to master to enable remote vnc access to vm
  - Store socket id instead of socket itself in ticket
###Version 1.1.3
  - Add check if machine consoles have become active
  - separate configuration for NFS shares
  - send encrypted SSL keys to master
  - added various dns resolution methods
###Version 1.1
  - add NFS shares to launching machine UserData.
  - Combine download requests to master for data and tool in one. (APIversion 1.1)
  - Introduce APIversion for the exchange of messages between master and hub.
  - always use a MySQL pool and not dedicated connections.
  - allow for a specific AMI for each tool. There should be a Default AMI as a fallback.
  - support both PV and HVM AMIs. Start machines based on the right AMI depending
    on their speed (instanceType)
  - Bug fix: report error if a machine fails to start.
  - Refactor Code.
  - if a machine fails to start, retry up to a number of times specified in
    restartLimit param in the ticket class.
  - on getMachinesInfo check against ipAddress instead of privateIpAddress
    this makes sure that a machine will be reachable from the outside world.
  - set BlockDeviceMapping data to the launching instance according to its type
  - get and parse acknowledges after a message is sent to master
  - recover tickets (if was restarted and there were active sessions)
  - send ticket info to master
  - update sessionStatus in tickets
###Version 1.0
  - Send email notification upon session termination
  - Use a pool of connections to serve SQL updates
  - Set runningDir as well as commandFile to pass it to tool script
  - Reload config on SIGHUP
  - Dates are stored in "YYYY/MM/DD HH:MM:SS" format, 24h clock.
  - register machine's address on route53 under nefelus subdomain
  - Put sessionId as instance Name (Tag)
  - pass aws ids to instance
  - set machineType in UserData (set in RunInstances)
  - push data from a running session to S3
  - cancel a running session
  - Health checks during instance setup, restart on unexpected termination
  - VNC, PROMPT and LOG viewers are set with separate message.
  - set sessionId on instance metadata (Tag)
  - send X11idle timeout
  - get heartbeats from master with load data
