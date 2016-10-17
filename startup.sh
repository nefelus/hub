#!/bin/bash

tag="nefelus-hub"
sourceDir=/usr/share/nefelus/hub

cd $sourceDir

if [ -e hub.jx ]; then
  exe=hub.jx
  launcher=/usr/local/bin/jx
elif [ -e hub.js ]; then
  exe=hub.js
  launcher=node
if [[ -e hub.sh && -e hub ]]; then
  launcher=/bin/bash
  exe=hub.sh
fi

usage ()
{
    echo "Usage: $0 {start|stop}"
    RETVAL=1
}


start ()
{
  echo "`date -u '+%d %b %T -'` Starting Nefelus HUB service" | logger -t $tag 2>&1
  NODE_ENV=production forever --uid $tag --sourceDir $sourceDir -a -e >(logger -t $tag) -o >(logger -t $tag) -c $launcher start $exe
}

stop()
{
  echo "`date -u '+%d %b %T -'` Stoping Nefelus HUB service" | logger -t $tag 2>&1
  NODE_ENV=production forever --uid $tag --sourceDir $sourceDir -c $launcher stop $exe
}

case "$1" in
    start) start; RETVAL=$? ;;
    stop) stop; RETVAL=$? ;;
    *) usage; RETVAL=2 ;;
esac

exit $RETVAL
